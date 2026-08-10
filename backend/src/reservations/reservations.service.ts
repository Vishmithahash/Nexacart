import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClockService } from '../common/clock/clock.service';
import {
  InventoryMovementType,
  InventoryReservationStatus,
} from '../generated/prisma/client';
import { ExpireReservationsDto } from './dto/expire-reservations-query.dto';

export interface ExpiryBatchResult {
  examined: number;
  expired: number;
  alreadyProcessed: number;
  failed: number;
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly clockService: ClockService,
  ) {}

  async expireDueReservations(
    dto: ExpireReservationsDto,
  ): Promise<ExpiryBatchResult> {
    const now = this.clockService.now();
    const limit = dto.limit || 100;

    // Deterministically select due active reservations: expiresAt asc, id asc
    const dueReservations = await this.prisma.inventoryReservation.findMany({
      where: {
        status: InventoryReservationStatus.ACTIVE,
        expiresAt: { lte: now },
      },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: { product: true },
    });

    const examined = dueReservations.length;
    let expired = 0;
    let alreadyProcessed = 0;
    let failed = 0;

    for (const res of dueReservations) {
      try {
        const success = await this.prisma.$transaction(
          async (tx) => {
            // Lock and verify reservation status
            const currentRes = await tx.inventoryReservation.findUnique({
              where: { id: res.id },
            });

            if (
              !currentRes ||
              currentRes.status !== InventoryReservationStatus.ACTIVE
            ) {
              alreadyProcessed++;
              return false;
            }

            // Decrement product reserved quantity
            await tx.product.update({
              where: { id: res.productId },
              data: { reservedQuantity: { decrement: res.quantity } },
            });

            // Record RELEASE movement
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
                reason: 'Controlled batch reservation expiry',
                referenceType: 'INVENTORY_RESERVATION',
                referenceId: res.id,
              },
            });

            // Mark reservation EXPIRED
            await tx.inventoryReservation.update({
              where: { id: res.id },
              data: {
                status: InventoryReservationStatus.EXPIRED,
                releasedAt: now,
                releaseReason: 'RESERVATION_EXPIRED',
              },
            });

            // Increment Cart version
            await tx.cart.update({
              where: { id: res.cartId },
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
                  cartId: res.cartId,
                  productId: res.productId,
                  quantity: res.quantity,
                },
              },
              tx,
            );

            return true;
          },
          { isolationLevel: 'Serializable' },
        );

        if (success) {
          expired++;
        }
      } catch (err: unknown) {
        this.logger.error(`Failed to expire reservation ${res.id}`, err);
        failed++;
      }
    }

    return {
      examined,
      expired,
      alreadyProcessed,
      failed,
    };
  }
}
