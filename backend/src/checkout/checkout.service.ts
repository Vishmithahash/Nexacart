import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import { ApiException } from '../common/exceptions/api.exception';
import {
  AddressType,
  CartMutationType,
  CartStatus,
  InventoryMovementType,
  InventoryReservationStatus,
  ProductStatus,
} from '../generated/prisma/client';
import { mapOrderToResponse, OrderResponse } from '../orders/order.mapper';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

const MAX_RETRIES = 3;
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';
const PRISMA_SERIALIZATION_CODE = 'P2034';

export interface CheckoutResult {
  replayed: boolean;
  order: OrderResponse;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly clockService: ClockService,
  ) {}

  // ── Public Checkout Entry Point ────────────────────────────────────────────

  async checkout(
    userId: number,
    dto: CreateCheckoutDto,
    rawIdempotencyKey: string | undefined,
  ): Promise<CheckoutResult> {
    // Step 1: Validate idempotency key
    if (!rawIdempotencyKey) {
      throw ApiException.checkoutIdempotencyKeyRequired();
    }
    const idempotencyKey = rawIdempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw ApiException.checkoutIdempotencyKeyRequired();
    }

    // Step 2: Compute SHA-256 request hash
    // NOTE: We need the cartId for the hash, but we don't know it yet.
    // We'll look it up first (read-only, outside transaction) to seed the hash.
    const cart = await this.prisma.cart.findFirst({
      where: { userId, status: CartStatus.ACTIVE },
    });

    if (!cart) {
      throw ApiException.checkoutCartNotFound();
    }

    const requestHash = this.computeRequestHash(
      userId,
      cart.id,
      dto.shippingAddressId,
      dto.expectedCartVersion,
    );

    // Retry loop for serialization failures
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.executeCheckout(
          userId,
          dto,
          idempotencyKey,
          requestHash,
          cart.id,
        );
      } catch (err: unknown) {
        const pgCode = this.extractPgCode(err);
        if (
          pgCode === PG_SERIALIZATION_FAILURE ||
          pgCode === PG_DEADLOCK_DETECTED ||
          pgCode === PRISMA_SERIALIZATION_CODE
        ) {
          this.logger.warn(
            `Checkout serialization conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`,
          );
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  // ── Internal Checkout Transaction ─────────────────────────────────────────

  private async executeCheckout(
    userId: number,
    dto: CreateCheckoutDto,
    idempotencyKey: string,
    requestHash: string,
    cartId: number,
  ): Promise<CheckoutResult> {
    const now = this.clockService.now();
    const ctx = this.requestContext.get();

    return this.prisma.$transaction(
      async (tx) => {
        // ── STEP 1: Check idempotency replay ──────────────────────────────
        const existingMutation = await tx.cartMutation.findUnique({
          where: {
            userId_type_idempotencyKey: {
              userId,
              type: CartMutationType.CHECKOUT,
              idempotencyKey,
            },
          },
        });

        if (existingMutation) {
          if (existingMutation.requestHash !== requestHash) {
            throw ApiException.checkoutIdempotencyConflict();
          }
          // Replay: return the stored order
          const storedOrderId = (
            existingMutation.responseBody as { orderId: number }
          ).orderId;
          const storedOrder = await tx.order.findUnique({
            where: { id: storedOrderId },
            include: { items: true },
          });
          if (storedOrder) {
            await this.auditService.logInTransaction(
              {
                userId,
                action: 'CHECKOUT_REPLAYED',
                entityType: 'Order',
                entityId: String(storedOrder.id),
                success: true,
                metadata: {
                  orderNumber: storedOrder.orderNumber,
                  cartId,
                  idempotencyKey,
                  replayed: true,
                },
              },
              tx,
            );
            return { replayed: true, order: mapOrderToResponse(storedOrder) };
          }
        }

        // ── STEP 2: Load ACTIVE cart with items, products, categories, reservations ──
        const fullCart = await tx.cart.findFirst({
          where: { id: cartId, userId, status: CartStatus.ACTIVE },
          include: {
            items: {
              orderBy: { productId: 'asc' }, // deterministic ordering for deadlock prevention
              include: {
                product: {
                  include: { category: true },
                },
                reservations: {
                  where: { status: InventoryReservationStatus.ACTIVE },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });

        if (!fullCart) {
          throw ApiException.checkoutCartNotFound();
        }

        // ── STEP 3: Check cart version ────────────────────────────────────
        if (fullCart.version !== dto.expectedCartVersion) {
          throw ApiException.checkoutCartChanged();
        }

        // ── STEP 4: Validate cart is not empty ────────────────────────────
        if (fullCart.items.length === 0) {
          throw ApiException.checkoutCartEmpty();
        }

        // ── STEP 5: Validate shipping address ─────────────────────────────
        const address = await tx.address.findFirst({
          where: {
            id: dto.shippingAddressId,
            userId,
            type: AddressType.SHIPPING,
          },
        });

        if (!address) {
          throw ApiException.checkoutShippingAddressNotFound();
        }

        const shippingAddressSnapshot = {
          sourceAddressId: address.id,
          fullName: address.fullName,
          phone: address.phone,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2 ?? null,
          city: address.city,
          state: address.state ?? null,
          postalCode: address.postalCode,
          country: address.country,
        };

        // ── STEP 6: Validate all items & reservations ─────────────────────
        for (const item of fullCart.items) {
          const { product } = item;

          if (!product || product.status !== ProductStatus.ACTIVE) {
            throw ApiException.checkoutFailed(
              `Product "${product?.name ?? item.productId}" is no longer active.`,
            );
          }

          if (!product.category || !product.category.isActive) {
            throw ApiException.checkoutFailed(
              `Product "${product.name}" belongs to an inactive category.`,
            );
          }

          const activeReservation = item.reservations[0];

          if (!activeReservation) {
            throw ApiException.checkoutReservationMissing(product.sku);
          }

          if (activeReservation.expiresAt <= now) {
            throw ApiException.checkoutReservationExpired(product.sku);
          }

          if (activeReservation.quantity !== item.quantity) {
            throw ApiException.checkoutReservationMismatch(product.sku);
          }

          const availableForSale = product.stockQuantity;
          if (availableForSale < item.quantity) {
            throw ApiException.checkoutInventoryConflict(product.sku);
          }
        }

        // ── STEP 7: Calculate totals (Decimal arithmetic, no float) ───────
        let subtotalDecimal = new Decimal(0);
        const itemCalculations = fullCart.items.map((item) => {
          const unitPrice = item.unitPrice;
          const lineTotal = unitPrice.mul(item.quantity);
          subtotalDecimal = subtotalDecimal.add(lineTotal);
          return { item, unitPrice, lineTotal };
        });

        const discountAmount = new Decimal(0);
        const shippingAmount = new Decimal(0);
        const totalAmount = subtotalDecimal
          .add(discountAmount)
          .add(shippingAmount);
        const currencyCode = fullCart.items[0]?.product?.currencyCode ?? 'LKR';

        // ── STEP 8: Generate unique order number ──────────────────────────
        const orderNumber = `NXC-${randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`;

        // ── STEP 9: Create Order ──────────────────────────────────────────
        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            sourceCartId: fullCart.id,
            status: 'PENDING',
            paymentStatus: 'PENDING',
            shipmentStatus: 'NOT_READY',
            subtotal: subtotalDecimal,
            discountAmount,
            shippingAmount,
            totalAmount,
            currencyCode,
            shippingAddress: shippingAddressSnapshot,
            placedAt: now,
          },
        });

        // ── STEP 10: Create OrderItems (historical snapshots) ─────────────
        const createdOrderItems: Array<{
          id: number;
          productId: number;
          sku: string;
          productName: string;
          quantity: number;
          unitPrice: Decimal;
          lineTotal: Decimal;
        }> = [];

        for (const { item, unitPrice, lineTotal } of itemCalculations) {
          const orderItem = await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              sku: item.product.sku,
              productName: item.product.name,
              quantity: item.quantity,
              unitPrice,
              lineTotal,
            },
          });
          createdOrderItems.push(orderItem);
        }

        // ── STEP 11-13: Consume inventory per item (sorted by productId) ──
        for (let i = 0; i < fullCart.items.length; i++) {
          const item = fullCart.items[i];
          const activeReservation = item.reservations[0];
          const orderItem = createdOrderItems[i];
          const { product } = item;

          // Guarded update: decrement both stockQuantity and reservedQuantity atomically
          const updatedProduct = await tx.product.updateManyAndReturn({
            where: {
              id: item.productId,
              stockQuantity: { gte: item.quantity },
              reservedQuantity: { gte: item.quantity },
            },
            data: {
              stockQuantity: { decrement: item.quantity },
              reservedQuantity: { decrement: item.quantity },
            },
          });

          if (!updatedProduct || updatedProduct.length === 0) {
            throw ApiException.checkoutInventoryConflict(product.sku);
          }

          const afterStock = product.stockQuantity - item.quantity;
          const afterReserved = product.reservedQuantity - item.quantity;

          // Create SALE inventory movement
          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              actorUserId: userId,
              type: InventoryMovementType.SALE,
              quantity: item.quantity,
              stockBefore: product.stockQuantity,
              stockAfter: afterStock,
              reservedBefore: product.reservedQuantity,
              reservedAfter: afterReserved,
              reason: `Order checkout: ${orderNumber}`,
              referenceType: 'ORDER_ITEM',
              referenceId: String(orderItem.id),
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });

          // Mark reservation as CONSUMED
          await tx.inventoryReservation.update({
            where: { id: activeReservation.id },
            data: {
              status: InventoryReservationStatus.CONSUMED,
              consumedAt: now,
            },
          });

          await this.auditService.logInTransaction(
            {
              userId,
              action: 'INVENTORY_RESERVATION_CONSUMED',
              entityType: 'InventoryReservation',
              entityId: activeReservation.id,
              success: true,
              metadata: {
                cartId: fullCart.id,
                productId: item.productId,
                sku: product.sku,
                quantity: item.quantity,
                orderId: order.id,
                orderNumber,
              },
            },
            tx,
          );
        }

        // ── STEP 14: Convert Cart to CONVERTED ────────────────────────────
        await tx.cart.update({
          where: { id: fullCart.id },
          data: {
            status: CartStatus.CONVERTED,
            version: { increment: 1 },
            lastActivityAt: now,
          },
        });

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'CART_CONVERTED',
            entityType: 'Cart',
            entityId: String(fullCart.id),
            success: true,
            metadata: {
              cartId: fullCart.id,
              orderId: order.id,
              orderNumber,
              itemCount: fullCart.items.length,
            },
          },
          tx,
        );

        // ── STEP 15: Record CartMutation for idempotency ───────────────────
        const responseBody = {
          orderId: order.id,
          orderNumber,
          subtotal: subtotalDecimal.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          currencyCode,
          itemCount: fullCart.items.length,
        };

        await tx.cartMutation.create({
          data: {
            userId,
            cartId: fullCart.id,
            type: CartMutationType.CHECKOUT,
            idempotencyKey,
            requestHash,
            responseStatus: 201,
            responseBody,
            completedAt: now,
            requestId: ctx?.requestId ?? null,
            qaRunId: ctx?.qaRunId ?? null,
            toolCallId: ctx?.toolCallId ?? null,
          },
        });

        // ── STEP 16: Audit checkout success ───────────────────────────────
        await this.auditService.logInTransaction(
          {
            userId,
            action: 'CHECKOUT_SUCCEEDED',
            entityType: 'Order',
            entityId: String(order.id),
            success: true,
            metadata: {
              orderNumber,
              cartId: fullCart.id,
              shippingAddressId: dto.shippingAddressId,
              itemCount: fullCart.items.length,
              subtotal: subtotalDecimal.toFixed(2),
              totalAmount: totalAmount.toFixed(2),
              currencyCode,
              reservationIds: fullCart.items.map((i) => i.reservations[0]?.id),
            },
          },
          tx,
        );

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'ORDER_CREATED',
            entityType: 'Order',
            entityId: String(order.id),
            success: true,
            metadata: {
              orderNumber,
              sourceCartId: fullCart.id,
              userId,
              itemCount: createdOrderItems.length,
              subtotal: subtotalDecimal.toFixed(2),
              totalAmount: totalAmount.toFixed(2),
            },
          },
          tx,
        );

        const fullOrder = {
          ...order,
          items: createdOrderItems,
        };

        return { replayed: false, order: mapOrderToResponse(fullOrder) };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private computeRequestHash(
    userId: number,
    cartId: number,
    shippingAddressId: number,
    expectedCartVersion: number,
  ): string {
    const payload = JSON.stringify({
      userId,
      cartId,
      shippingAddressId,
      expectedCartVersion,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private extractPgCode(err: unknown): string | undefined {
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (typeof e['code'] === 'string') return e['code'];
      if (e['meta'] && typeof e['meta'] === 'object') {
        const meta = e['meta'] as Record<string, unknown>;
        if (typeof meta['code'] === 'string') return meta['code'];
      }
    }
    return undefined;
  }
}
