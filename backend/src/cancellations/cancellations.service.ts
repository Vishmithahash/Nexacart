import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import { ApiException } from '../common/exceptions/api.exception';
import {
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
  InventoryMovementType,
} from '../generated/prisma/client';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { mapOrderToResponse, OrderResponse } from '../orders/order.mapper';

export interface CancelOrderResult {
  replayed: boolean;
  order: OrderResponse;
  refundRequired: boolean;
}

const MAX_RETRIES = 3;
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';
const PRISMA_SERIALIZATION_CODE = 'P2034';

@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly clockService: ClockService,
  ) {}

  async cancelOrder(
    userId: number,
    orderNumber: string,
    dto: CancelOrderDto,
    rawIdempotencyKey: string | undefined,
  ): Promise<CancelOrderResult> {
    // 1. Validate idempotency key
    if (!rawIdempotencyKey) {
      throw ApiException.paymentIdempotencyKeyRequired();
    }
    const idempotencyKey = rawIdempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw ApiException.paymentIdempotencyKeyRequired();
    }

    const normalizedReason = dto.reason.trim();

    // 2. Initial lookup
    const existingOrder = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true, payment: true },
    });

    if (!existingOrder || existingOrder.userId !== userId) {
      throw ApiException.orderNotFound();
    }

    const requestHash = this.computeCancelRequestHash(
      userId,
      existingOrder.id,
      normalizedReason,
    );

    // 3. Retry loop for serializable transactions
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.executeCancellationTransaction(
          userId,
          existingOrder.id,
          normalizedReason,
          idempotencyKey,
          requestHash,
        );
      } catch (err: unknown) {
        const pgCode = this.extractPgCode(err);
        if (
          pgCode === PG_SERIALIZATION_FAILURE ||
          pgCode === PG_DEADLOCK_DETECTED ||
          pgCode === PRISMA_SERIALIZATION_CODE
        ) {
          this.logger.warn(
            `Cancellation serialization conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`,
          );
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  private async executeCancellationTransaction(
    userId: number,
    orderId: number,
    reason: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CancelOrderResult> {
    const now = this.clockService.now();
    const ctx = this.requestContext.get();

    return this.prisma.$transaction(
      async (tx) => {
        // Step A: Load order with items ordered by productId ASC for deterministic lock order
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            items: {
              orderBy: { productId: 'asc' },
              include: { product: true },
            },
            payment: true,
            refunds: true,
          },
        });

        if (!order || order.userId !== userId) {
          throw ApiException.orderNotFound();
        }

        // Step B: Check if already cancelled
        if (order.status === OrderStatus.CANCELLED) {
          if (order.cancelIdempotencyKey === idempotencyKey) {
            if (order.cancelRequestHash !== requestHash) {
              throw ApiException.orderCancellationIdempotencyConflict();
            }
            const refundRequired =
              order.paymentStatus === PaymentStatus.PAID ||
              order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED;

            await this.auditService.logInTransaction(
              {
                userId,
                action: 'ORDER_CANCELLATION_REPLAYED',
                entityType: 'Order',
                entityId: String(order.id),
                success: true,
                metadata: {
                  orderNumber: order.orderNumber,
                  idempotencyKey,
                  replayed: true,
                },
              },
              tx,
            );

            return {
              replayed: true,
              order: mapOrderToResponse(order),
              refundRequired,
            };
          } else {
            throw ApiException.orderAlreadyCancelled();
          }
        }

        // Check if idempotency key used for a different active order cancel attempt
        if (order.cancelIdempotencyKey === idempotencyKey) {
          if (order.cancelRequestHash !== requestHash) {
            throw ApiException.orderCancellationIdempotencyConflict();
          }
        }

        // Step C: Business rules validation
        if (
          order.status === OrderStatus.COMPLETED ||
          order.shipmentStatus === ShipmentStatus.SHIPPED ||
          order.shipmentStatus === ShipmentStatus.DELIVERED
        ) {
          throw ApiException.orderNotCancellable(
            `Order in ${order.status} state with shipment ${order.shipmentStatus} cannot be cancelled.`,
          );
        }

        if (
          order.status !== OrderStatus.PENDING &&
          order.status !== OrderStatus.CONFIRMED
        ) {
          throw ApiException.orderNotCancellable(
            `Order in ${order.status} state cannot be cancelled (must be PENDING or CONFIRMED).`,
          );
        }

        // Step D: Restore stock for each item & record CANCELLATION_RESTORE inventory movements
        for (const item of order.items) {
          const product = item.product;

          const updatedProduct = await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQuantity: { increment: item.quantity },
              version: { increment: 1 },
            },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              actorUserId: userId,
              type: InventoryMovementType.CANCELLATION_RESTORE,
              quantity: item.quantity,
              stockBefore: product.stockQuantity,
              stockAfter: updatedProduct.stockQuantity,
              reservedBefore: product.reservedQuantity,
              reservedAfter: product.reservedQuantity,
              reason: `Order cancellation: ${order.orderNumber}`,
              referenceType: 'ORDER_ITEM',
              referenceId: String(item.id),
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });
        }

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'INVENTORY_RESTORED_AFTER_CANCELLATION',
            entityType: 'Order',
            entityId: String(order.id),
            success: true,
            metadata: {
              orderNumber: order.orderNumber,
              itemCount: order.items.length,
            },
          },
          tx,
        );

        // Step E: Update Order to CANCELLED
        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: reason,
            cancelledAt: now,
            cancelledByUserId: userId,
            cancelIdempotencyKey: idempotencyKey,
            cancelRequestHash: requestHash,
          },
          include: {
            items: { orderBy: { id: 'asc' } },
            payment: true,
            refunds: true,
          },
        });

        const refundRequired =
          order.paymentStatus === PaymentStatus.PAID ||
          order.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED;

        await this.auditService.logInTransaction(
          {
            userId,
            action: 'ORDER_CANCELLED',
            entityType: 'Order',
            entityId: String(order.id),
            success: true,
            metadata: {
              orderNumber: order.orderNumber,
              reason,
              refundRequired,
              previousStatus: order.status,
              paymentStatus: order.paymentStatus,
            },
          },
          tx,
        );

        return {
          replayed: false,
          order: mapOrderToResponse(updatedOrder),
          refundRequired,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private computeCancelRequestHash(
    userId: number,
    orderId: number,
    reason: string,
  ): string {
    const payload = JSON.stringify({ userId, orderId, reason });
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
