import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import { ApiException } from '../common/exceptions/api.exception';
import {
  CartMutationType,
  CartStatus,
  InventoryMovementType,
  InventoryReservationStatus,
  ProductStatus,
} from '../generated/prisma/client';
import { mapCartToResponse, CartResponse } from './cart.mapper';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { ReserveCartItemDto } from './dto/reserve-cart-item.dto';

type PrismaTransactionClient = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

const MAX_RETRIES = 3;
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';

export interface MutationExecutionResult {
  statusCode: number;
  body: CartResponse;
  replayed: boolean;
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  private readonly reservationTtlMinutes: number;
  private readonly maxDistinctItems: number;
  private readonly maxItemQuantity: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly clockService: ClockService,
    private readonly configService: ConfigService,
  ) {
    this.reservationTtlMinutes = this.configService.get<number>(
      'CART_RESERVATION_TTL_MINUTES',
      30,
    );
    this.maxDistinctItems = this.configService.get<number>(
      'CART_MAX_DISTINCT_ITEMS',
      50,
    );
    this.maxItemQuantity = this.configService.get<number>(
      'CART_MAX_ITEM_QUANTITY',
      100,
    );
  }

  // ── Get Active Cart ────────────────────────────────────────────────────────

  async getActiveCart(userId: number): Promise<CartResponse> {
    const now = this.clockService.now();

    let cart = await this.prisma.cart.findFirst({
      where: { userId, status: CartStatus.ACTIVE },
      include: {
        items: {
          include: {
            product: true,
            reservations: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!cart) {
      // Get-or-create active cart safely
      try {
        cart = await this.prisma.cart.create({
          data: {
            userId,
            status: CartStatus.ACTIVE,
            version: 1,
            lastActivityAt: now,
          },
          include: {
            items: {
              include: {
                product: true,
                reservations: {
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        });
      } catch (err: unknown) {
        // Race condition: if another request created active cart concurrently
        cart = await this.prisma.cart.findFirstOrThrow({
          where: { userId, status: CartStatus.ACTIVE },
          include: {
            items: {
              include: {
                product: true,
                reservations: {
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        });
      }
    }

    // Auto-process expired reservations for this cart before returning
    await this.processExpiredReservationsForCart(cart.id, now);

    // Re-fetch cart with updated reservation statuses
    const updatedCart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            product: true,
            reservations: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    return mapCartToResponse(updatedCart, now);
  }

  // ── Add Item ───────────────────────────────────────────────────────────────

  async addItem(
    userId: number,
    dto: AddCartItemDto,
    idempotencyKey: string,
  ): Promise<MutationExecutionResult> {
    const requestHash = this.computeRequestHash(
      userId,
      CartMutationType.ADD_ITEM,
      dto,
    );

    return this.executeMutation(
      userId,
      CartMutationType.ADD_ITEM,
      idempotencyKey,
      requestHash,
      async (tx, ctx, now) => {
        // 1. Validate quantity
        if (dto.quantity > this.maxItemQuantity) {
          throw ApiException.cartItemQuantityInvalid(
            `Quantity cannot exceed maximum of ${this.maxItemQuantity}.`,
          );
        }

        // 2. Validate product
        const product = await tx.product.findUnique({
          where: { id: dto.productId },
          include: { category: true },
        });

        if (!product) {
          throw ApiException.productNotFound();
        }

        if (product.status !== ProductStatus.ACTIVE) {
          throw ApiException.productInactive();
        }

        if (!product.category || !product.category.isActive) {
          throw ApiException.productCategoryInactive();
        }

        // 3. Get or create active cart inside transaction
        let cart = await tx.cart.findFirst({
          where: { userId, status: CartStatus.ACTIVE },
          include: {
            items: {
              include: {
                product: true,
                reservations: {
                  where: { status: InventoryReservationStatus.ACTIVE },
                },
              },
            },
          },
        });

        if (!cart) {
          if (dto.expectedCartVersion !== 0 && dto.expectedCartVersion !== 1) {
            throw ApiException.cartVersionConflict();
          }
          cart = await tx.cart.create({
            data: {
              userId,
              status: CartStatus.ACTIVE,
              version: 1,
              lastActivityAt: now,
            },
            include: {
              items: {
                include: {
                  product: true,
                  reservations: {
                    where: { status: InventoryReservationStatus.ACTIVE },
                  },
                },
              },
            },
          });
        } else {
          // Version check
          if (cart.version !== dto.expectedCartVersion) {
            throw ApiException.cartVersionConflict();
          }
        }

        // 4. Check cart item count limit
        const existingItem = cart.items.find(
          (i) => i.productId === dto.productId,
        );
        if (!existingItem && cart.items.length >= this.maxDistinctItems) {
          throw ApiException.cartItemLimitReached(this.maxDistinctItems);
        }

        const newQuantity =
          (existingItem ? existingItem.quantity : 0) + dto.quantity;
        if (newQuantity > this.maxItemQuantity) {
          throw ApiException.cartItemQuantityInvalid(
            `Total item quantity would exceed maximum of ${this.maxItemQuantity}.`,
          );
        }

        // 5. Stock check & reservation delta
        const availableStock = product.stockQuantity - product.reservedQuantity;
        if (availableStock < dto.quantity) {
          throw ApiException.reservationInsufficientStock();
        }

        const stockBefore = product.stockQuantity;
        const reservedBefore = product.reservedQuantity;
        const reservedAfter = reservedBefore + dto.quantity;

        // Atomically update product reservedQuantity
        const updatedProduct = await tx.product.update({
          where: { id: product.id },
          data: { reservedQuantity: { increment: dto.quantity } },
        });

        if (updatedProduct.reservedQuantity > updatedProduct.stockQuantity) {
          throw ApiException.reservationInsufficientStock();
        }

        // Create immutable RESERVATION movement
        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            actorUserId: userId,
            type: InventoryMovementType.RESERVATION,
            quantity: dto.quantity,
            stockBefore,
            stockAfter: stockBefore,
            reservedBefore,
            reservedAfter,
            reason: 'Cart item added',
            referenceType: 'CART_ITEM',
            requestId: ctx?.requestId ?? null,
            qaRunId: ctx?.qaRunId ?? null,
            toolCallId: ctx?.toolCallId ?? null,
            metadata: { cartId: cart.id, addedQuantity: dto.quantity },
          },
        });

        // 6. Create or update CartItem
        let cartItemId: number;
        if (existingItem) {
          cartItemId = existingItem.id;
          await tx.cartItem.update({
            where: { id: existingItem.id },
            data: {
              quantity: newQuantity,
              unitPrice: product.price, // Update snapshot on successful addition
            },
          });

          // Mark existing active reservation RELEASED or update quantity
          const existingRes = existingItem.reservations[0];
          if (existingRes) {
            await tx.inventoryReservation.update({
              where: { id: existingRes.id },
              data: {
                status: InventoryReservationStatus.RELEASED,
                releasedAt: now,
                releaseReason: 'QUANTITY_UPDATED',
              },
            });
          }
        } else {
          const createdItem = await tx.cartItem.create({
            data: {
              cartId: cart.id,
              productId: product.id,
              quantity: dto.quantity,
              unitPrice: product.price,
            },
          });
          cartItemId = createdItem.id;
        }

        // 7. Create ACTIVE InventoryReservation
        const expiresAt = new Date(
          now.getTime() + this.reservationTtlMinutes * 60 * 1000,
        );
        await tx.inventoryReservation.create({
          data: {
            cartId: cart.id,
            cartItemId,
            productId: product.id,
            quantity: newQuantity,
            status: InventoryReservationStatus.ACTIVE,
            expiresAt,
            requestId: ctx?.requestId ?? null,
            qaRunId: ctx?.qaRunId ?? null,
            toolCallId: ctx?.toolCallId ?? null,
          },
        });

        // 8. Increment Cart.version
        const updatedCart = await tx.cart.update({
          where: { id: cart.id },
          data: {
            version: { increment: 1 },
            lastActivityAt: now,
          },
          include: {
            items: {
              include: {
                product: true,
                reservations: { orderBy: { createdAt: 'desc' } },
              },
            },
          },
        });

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'CART_ITEM_ADDED',
            entityType: 'Cart',
            entityId: String(cart.id),
            success: true,
            metadata: {
              productId: product.id,
              sku: product.sku,
              quantityAdded: dto.quantity,
              totalQuantity: newQuantity,
              version: updatedCart.version,
            },
          },
          tx,
        );

        return {
          cart: mapCartToResponse(updatedCart, now),
          cartId: cart.id,
        };
      },
    );
  }

  // ── Update Item Quantity ───────────────────────────────────────────────────

  async updateItemQuantity(
    userId: number,
    itemId: number,
    dto: UpdateCartItemDto,
    idempotencyKey: string,
  ): Promise<MutationExecutionResult> {
    const requestHash = this.computeRequestHash(
      userId,
      CartMutationType.UPDATE_ITEM,
      {
        itemId,
        ...dto,
      },
    );

    return this.executeMutation(
      userId,
      CartMutationType.UPDATE_ITEM,
      idempotencyKey,
      requestHash,
      async (tx, ctx, now) => {
        // 1. Find cart item with cart ownership check
        const item = await tx.cartItem.findUnique({
          where: { id: itemId },
          include: {
            cart: true,
            product: true,
            reservations: { orderBy: { createdAt: 'desc' } },
          },
        });

        if (
          !item ||
          item.cart.userId !== userId ||
          item.cart.status !== CartStatus.ACTIVE
        ) {
          throw ApiException.cartItemNotFound();
        }

        // Version check
        if (item.cart.version !== dto.expectedCartVersion) {
          throw ApiException.cartVersionConflict();
        }

        if (dto.quantity > this.maxItemQuantity) {
          throw ApiException.cartItemQuantityInvalid(
            `Quantity cannot exceed maximum of ${this.maxItemQuantity}.`,
          );
        }

        const oldQuantity = item.quantity;
        const newQuantity = dto.quantity;

        // Same quantity — no state change
        if (oldQuantity === newQuantity) {
          const currentCart = await tx.cart.findUniqueOrThrow({
            where: { id: item.cartId },
            include: {
              items: {
                include: {
                  product: true,
                  reservations: { orderBy: { createdAt: 'desc' } },
                },
              },
            },
          });
          return {
            cart: mapCartToResponse(currentCart, now),
            cartId: item.cartId,
          };
        }

        const activeRes = item.reservations.find(
          (r) =>
            r.status === InventoryReservationStatus.ACTIVE && r.expiresAt > now,
        );

        const delta = newQuantity - oldQuantity;

        if (delta > 0) {
          // Increase quantity — reserve delta
          const availableStock =
            item.product.stockQuantity - item.product.reservedQuantity;
          if (availableStock < delta) {
            throw ApiException.reservationInsufficientStock();
          }

          await tx.product.update({
            where: { id: item.productId },
            data: { reservedQuantity: { increment: delta } },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              actorUserId: userId,
              type: InventoryMovementType.RESERVATION,
              quantity: delta,
              stockBefore: item.product.stockQuantity,
              stockAfter: item.product.stockQuantity,
              reservedBefore: item.product.reservedQuantity,
              reservedAfter: item.product.reservedQuantity + delta,
              reason: 'Cart item quantity increased',
              referenceType: 'CART_ITEM',
              referenceId: String(item.id),
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });
        } else {
          // Decrease quantity — release delta
          const releaseQty = Math.abs(delta);
          await tx.product.update({
            where: { id: item.productId },
            data: { reservedQuantity: { decrement: releaseQty } },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              actorUserId: userId,
              type: InventoryMovementType.RELEASE,
              quantity: releaseQty,
              stockBefore: item.product.stockQuantity,
              stockAfter: item.product.stockQuantity,
              reservedBefore: item.product.reservedQuantity,
              reservedAfter: Math.max(
                0,
                item.product.reservedQuantity - releaseQty,
              ),
              reason: 'Cart item quantity decreased',
              referenceType: 'CART_ITEM',
              referenceId: String(item.id),
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });
        }

        // Release old active reservation if exists
        if (activeRes) {
          await tx.inventoryReservation.update({
            where: { id: activeRes.id },
            data: {
              status: InventoryReservationStatus.RELEASED,
              releasedAt: now,
              releaseReason: 'QUANTITY_UPDATED',
            },
          });
        }

        // Create new ACTIVE reservation
        const expiresAt = new Date(
          now.getTime() + this.reservationTtlMinutes * 60 * 1000,
        );
        await tx.inventoryReservation.create({
          data: {
            cartId: item.cartId,
            cartItemId: item.id,
            productId: item.productId,
            quantity: newQuantity,
            status: InventoryReservationStatus.ACTIVE,
            expiresAt,
            requestId: ctx?.requestId ?? null,
            qaRunId: ctx?.qaRunId ?? null,
            toolCallId: ctx?.toolCallId ?? null,
          },
        });

        // Update CartItem quantity
        await tx.cartItem.update({
          where: { id: item.id },
          data: { quantity: newQuantity },
        });

        // Increment cart version
        const updatedCart = await tx.cart.update({
          where: { id: item.cartId },
          data: {
            version: { increment: 1 },
            lastActivityAt: now,
          },
          include: {
            items: {
              include: {
                product: true,
                reservations: { orderBy: { createdAt: 'desc' } },
              },
            },
          },
        });

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'CART_ITEM_UPDATED',
            entityType: 'Cart',
            entityId: String(item.cartId),
            success: true,
            metadata: {
              itemId,
              oldQuantity,
              newQuantity,
              version: updatedCart.version,
            },
          },
          tx,
        );

        return {
          cart: mapCartToResponse(updatedCart, now),
          cartId: item.cartId,
        };
      },
    );
  }

  // ── Remove Item ────────────────────────────────────────────────────────────

  async removeItem(
    userId: number,
    itemId: number,
    expectedCartVersion: number,
    idempotencyKey: string,
  ): Promise<MutationExecutionResult> {
    const requestHash = this.computeRequestHash(
      userId,
      CartMutationType.REMOVE_ITEM,
      {
        itemId,
        expectedCartVersion,
      },
    );

    return this.executeMutation(
      userId,
      CartMutationType.REMOVE_ITEM,
      idempotencyKey,
      requestHash,
      async (tx, ctx, now) => {
        const item = await tx.cartItem.findUnique({
          where: { id: itemId },
          include: {
            cart: true,
            product: true,
            reservations: {
              where: { status: InventoryReservationStatus.ACTIVE },
            },
          },
        });

        if (
          !item ||
          item.cart.userId !== userId ||
          item.cart.status !== CartStatus.ACTIVE
        ) {
          throw ApiException.cartItemNotFound();
        }

        if (item.cart.version !== expectedCartVersion) {
          throw ApiException.cartVersionConflict();
        }

        // Release active reservation
        const activeRes = item.reservations[0];
        if (activeRes) {
          await tx.product.update({
            where: { id: item.productId },
            data: { reservedQuantity: { decrement: activeRes.quantity } },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              actorUserId: userId,
              type: InventoryMovementType.RELEASE,
              quantity: activeRes.quantity,
              stockBefore: item.product.stockQuantity,
              stockAfter: item.product.stockQuantity,
              reservedBefore: item.product.reservedQuantity,
              reservedAfter: Math.max(
                0,
                item.product.reservedQuantity - activeRes.quantity,
              ),
              reason: 'Cart item removed',
              referenceType: 'CART_ITEM',
              referenceId: String(item.id),
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });

          await tx.inventoryReservation.update({
            where: { id: activeRes.id },
            data: {
              status: InventoryReservationStatus.RELEASED,
              releasedAt: now,
              releaseReason: 'CART_ITEM_REMOVED',
            },
          });
        }

        // Delete CartItem
        await tx.cartItem.delete({ where: { id: item.id } });

        // Increment cart version
        const updatedCart = await tx.cart.update({
          where: { id: item.cartId },
          data: {
            version: { increment: 1 },
            lastActivityAt: now,
          },
          include: {
            items: {
              include: {
                product: true,
                reservations: { orderBy: { createdAt: 'desc' } },
              },
            },
          },
        });

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'CART_ITEM_REMOVED',
            entityType: 'Cart',
            entityId: String(item.cartId),
            success: true,
            metadata: { itemId, version: updatedCart.version },
          },
          tx,
        );

        return {
          cart: mapCartToResponse(updatedCart, now),
          cartId: item.cartId,
        };
      },
    );
  }

  // ── Clear Cart ─────────────────────────────────────────────────────────────

  async clearCart(
    userId: number,
    expectedCartVersion: number,
    idempotencyKey: string,
  ): Promise<MutationExecutionResult> {
    const requestHash = this.computeRequestHash(
      userId,
      CartMutationType.CLEAR_CART,
      {
        expectedCartVersion,
      },
    );

    return this.executeMutation(
      userId,
      CartMutationType.CLEAR_CART,
      idempotencyKey,
      requestHash,
      async (tx, ctx, now) => {
        const cart = await tx.cart.findFirst({
          where: { userId, status: CartStatus.ACTIVE },
          include: {
            items: {
              include: {
                product: true,
                reservations: {
                  where: { status: InventoryReservationStatus.ACTIVE },
                },
              },
            },
          },
        });

        if (!cart) {
          throw ApiException.cartNotFound();
        }

        if (cart.version !== expectedCartVersion) {
          throw ApiException.cartVersionConflict();
        }

        // Sort items by productId ascending to prevent deadlocks
        const sortedItems = [...cart.items].sort(
          (a, b) => a.productId - b.productId,
        );

        for (const item of sortedItems) {
          const activeRes = item.reservations[0];
          if (activeRes) {
            await tx.product.update({
              where: { id: item.productId },
              data: { reservedQuantity: { decrement: activeRes.quantity } },
            });

            await tx.inventoryMovement.create({
              data: {
                productId: item.productId,
                actorUserId: userId,
                type: InventoryMovementType.RELEASE,
                quantity: activeRes.quantity,
                stockBefore: item.product.stockQuantity,
                stockAfter: item.product.stockQuantity,
                reservedBefore: item.product.reservedQuantity,
                reservedAfter: Math.max(
                  0,
                  item.product.reservedQuantity - activeRes.quantity,
                ),
                reason: 'Cart cleared',
                referenceType: 'CART_ITEM',
                referenceId: String(item.id),
                requestId: ctx?.requestId ?? null,
                qaRunId: ctx?.qaRunId ?? null,
                toolCallId: ctx?.toolCallId ?? null,
              },
            });

            await tx.inventoryReservation.update({
              where: { id: activeRes.id },
              data: {
                status: InventoryReservationStatus.RELEASED,
                releasedAt: now,
                releaseReason: 'CART_CLEARED',
              },
            });
          }
        }

        // Delete all cart items
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        // Increment cart version ONCE
        const updatedCart = await tx.cart.update({
          where: { id: cart.id },
          data: {
            version: { increment: 1 },
            lastActivityAt: now,
          },
          include: {
            items: {
              include: {
                product: true,
                reservations: { orderBy: { createdAt: 'desc' } },
              },
            },
          },
        });

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'CART_CLEARED',
            entityType: 'Cart',
            entityId: String(cart.id),
            success: true,
            metadata: {
              clearedItemsCount: cart.items.length,
              version: updatedCart.version,
            },
          },
          tx,
        );

        return {
          cart: mapCartToResponse(updatedCart, now),
          cartId: cart.id,
        };
      },
    );
  }

  // ── Re-reserve Expired Cart Item ───────────────────────────────────────────

  async reserveCartItem(
    userId: number,
    itemId: number,
    dto: ReserveCartItemDto,
    idempotencyKey: string,
  ): Promise<MutationExecutionResult> {
    const requestHash = this.computeRequestHash(
      userId,
      CartMutationType.RESERVE_ITEM,
      {
        itemId,
        ...dto,
      },
    );

    return this.executeMutation(
      userId,
      CartMutationType.RESERVE_ITEM,
      idempotencyKey,
      requestHash,
      async (tx, ctx, now) => {
        const item = await tx.cartItem.findUnique({
          where: { id: itemId },
          include: {
            cart: true,
            product: { include: { category: true } },
            reservations: { orderBy: { createdAt: 'desc' } },
          },
        });

        if (
          !item ||
          item.cart.userId !== userId ||
          item.cart.status !== CartStatus.ACTIVE
        ) {
          throw ApiException.cartItemNotFound();
        }

        if (item.cart.version !== dto.expectedCartVersion) {
          throw ApiException.cartVersionConflict();
        }

        if (item.product.status !== ProductStatus.ACTIVE) {
          throw ApiException.productInactive();
        }

        if (!item.product.category || !item.product.category.isActive) {
          throw ApiException.productCategoryInactive();
        }

        // Check if item already has an unexpired ACTIVE reservation
        const activeRes = item.reservations.find(
          (r) =>
            r.status === InventoryReservationStatus.ACTIVE && r.expiresAt > now,
        );
        if (activeRes) {
          throw ApiException.reservationAlreadyReleased(); // Or already active conflict
        }

        // Check available stock
        const availableStock =
          item.product.stockQuantity - item.product.reservedQuantity;
        if (availableStock < item.quantity) {
          throw ApiException.reservationInsufficientStock();
        }

        // Reserve stock
        await tx.product.update({
          where: { id: item.productId },
          data: { reservedQuantity: { increment: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            actorUserId: userId,
            type: InventoryMovementType.RESERVATION,
            quantity: item.quantity,
            stockBefore: item.product.stockQuantity,
            stockAfter: item.product.stockQuantity,
            reservedBefore: item.product.reservedQuantity,
            reservedAfter: item.product.reservedQuantity + item.quantity,
            reason: 'Expired cart item re-reserved',
            referenceType: 'CART_ITEM',
            referenceId: String(item.id),
            requestId: ctx?.requestId ?? null,
            qaRunId: ctx?.qaRunId ?? null,
            toolCallId: ctx?.toolCallId ?? null,
          },
        });

        // Create new ACTIVE reservation & snapshot price
        const expiresAt = new Date(
          now.getTime() + this.reservationTtlMinutes * 60 * 1000,
        );
        await tx.inventoryReservation.create({
          data: {
            cartId: item.cartId,
            cartItemId: item.id,
            productId: item.productId,
            quantity: item.quantity,
            status: InventoryReservationStatus.ACTIVE,
            expiresAt,
            requestId: ctx?.requestId ?? null,
            qaRunId: ctx?.qaRunId ?? null,
            toolCallId: ctx?.toolCallId ?? null,
          },
        });

        // Update unitPrice to current price snapshot
        await tx.cartItem.update({
          where: { id: item.id },
          data: { unitPrice: item.product.price },
        });

        const updatedCart = await tx.cart.update({
          where: { id: item.cartId },
          data: {
            version: { increment: 1 },
            lastActivityAt: now,
          },
          include: {
            items: {
              include: {
                product: true,
                reservations: { orderBy: { createdAt: 'desc' } },
              },
            },
          },
        });

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'CART_ITEM_RERESERVED',
            entityType: 'Cart',
            entityId: String(item.cartId),
            success: true,
            metadata: {
              itemId,
              quantity: item.quantity,
              version: updatedCart.version,
            },
          },
          tx,
        );

        return {
          cart: mapCartToResponse(updatedCart, now),
          cartId: item.cartId,
        };
      },
    );
  }

  // ── Process Expired Reservations For Cart ─────────────────────────────

  async processExpiredReservationsForCart(
    cartId: number,
    now: Date,
  ): Promise<number> {
    const expiredReservations = await this.prisma.inventoryReservation.findMany(
      {
        where: {
          cartId,
          status: InventoryReservationStatus.ACTIVE,
          expiresAt: { lte: now },
        },
        include: { product: true },
      },
    );

    if (expiredReservations.length === 0) {
      return 0;
    }

    for (const res of expiredReservations) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const currentRes = await tx.inventoryReservation.findUnique({
              where: { id: res.id },
            });
            if (
              !currentRes ||
              currentRes.status !== InventoryReservationStatus.ACTIVE
            ) {
              return;
            }

            await tx.product.update({
              where: { id: res.productId },
              data: { reservedQuantity: { decrement: res.quantity } },
            });

            await tx.inventoryMovement.create({
              data: {
                productId: res.productId,
                actorUserId: null,
                type: InventoryMovementType.RELEASE,
                quantity: res.quantity,
                stockBefore: res.product.stockQuantity,
                stockAfter: res.product.stockQuantity,
                reservedBefore: res.product.reservedQuantity,
                reservedAfter: Math.max(
                  0,
                  res.product.reservedQuantity - res.quantity,
                ),
                reason: 'Cart item reservation expired',
                referenceType: 'INVENTORY_RESERVATION',
                referenceId: res.id,
              },
            });

            await tx.inventoryReservation.update({
              where: { id: res.id },
              data: {
                status: InventoryReservationStatus.EXPIRED,
                releasedAt: now,
                releaseReason: 'RESERVATION_EXPIRED',
              },
            });

            await tx.cart.update({
              where: { id: cartId },
              data: { version: { increment: 1 } },
            });

            await this.auditService.logInTransaction(
              {
                userId: undefined,
                action: 'CART_ITEM_RESERVATION_EXPIRED',
                entityType: 'InventoryReservation',
                entityId: res.id,
                success: true,
                metadata: {
                  cartId,
                  productId: res.productId,
                  quantity: res.quantity,
                },
              },
              tx,
            );
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Error expiring reservation ${res.id}: ${String(err)}`,
        );
      }
    }

    return expiredReservations.length;
  }

  // ── Helper: Idempotent Mutation Wrapper ───────────────────────────────────

  private async executeMutation(
    userId: number,
    type: CartMutationType,
    idempotencyKey: string,
    requestHash: string,
    operation: (
      tx: PrismaTransactionClient,
      ctx: any,
      now: Date,
    ) => Promise<{ cart: CartResponse; cartId: number }>,
  ): Promise<MutationExecutionResult> {
    const trimmedKey = idempotencyKey?.trim();
    if (!trimmedKey || trimmedKey.length < 8 || trimmedKey.length > 100) {
      throw ApiException.cartIdempotencyKeyRequired();
    }

    // Check existing mutation
    const existingMutation = await this.prisma.cartMutation.findUnique({
      where: {
        userId_type_idempotencyKey: {
          userId,
          type,
          idempotencyKey: trimmedKey,
        },
      },
    });

    if (existingMutation) {
      if (existingMutation.requestHash !== requestHash) {
        throw ApiException.cartIdempotencyConflict();
      }
      return {
        statusCode: 200,
        body: existingMutation.responseBody as unknown as CartResponse,
        replayed: true,
      };
    }

    const ctx = this.requestContext.get();
    const now = this.clockService.now();
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { cart, cartId } = await this.prisma.$transaction(
          async (tx) => {
            const result = await operation(tx, ctx, now);

            // Record CartMutation
            await tx.cartMutation.create({
              data: {
                userId,
                cartId: result.cartId,
                type,
                idempotencyKey: trimmedKey,
                requestHash,
                responseStatus: 200,
                responseBody: result.cart as any,
                requestId: ctx?.requestId ?? null,
                qaRunId: ctx?.qaRunId ?? null,
                toolCallId: ctx?.toolCallId ?? null,
                completedAt: now,
              },
            });

            return result;
          },
          { isolationLevel: 'Serializable' },
        );

        return {
          statusCode: 200,
          body: cart,
          replayed: false,
        };
      } catch (err: unknown) {
        if (this.isSerializationError(err) && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `Serialization error on cart mutation ${type}, retrying (${attempt + 1}/${MAX_RETRIES})...`,
          );
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  private computeRequestHash(
    userId: number,
    type: CartMutationType,
    payload: object,
  ): string {
    const canonical = JSON.stringify({ userId, type, payload });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private isSerializationError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as Record<string, unknown>;
    const code = e['code'] as string | undefined;
    return code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED;
  }
}
