import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QaFixtureContext } from '../fixtures/qa-fixture-context.type';
import {
  QaCartStateItemSnapshot,
  QaOrderStateSnapshot,
  QaProductStateSnapshot,
  QaStateSnapshotContent,
} from './qa-state.types';
import { InventoryMovementType, PaymentStatus, RefundStatus } from '../../generated/prisma/client';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class QaStateSnapshotService {
  private readonly logger = new Logger(QaStateSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Capture a canonical DB state snapshot for a fixture context.
   */
  async captureSnapshot(
    context: QaFixtureContext,
  ): Promise<QaStateSnapshotContent> {
    const userId = context.customerId;

    // 1. Fetch Cart
    const activeCart = await this.prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: {
        items: {
          include: {
            reservations: { orderBy: { createdAt: 'desc' } },
            product: true,
          },
        },
      },
    });

    const cartItemsMap: Record<string, QaCartStateItemSnapshot> = {};
    let cartTotalQuantity = 0;

    if (activeCart) {
      for (const item of activeCart.items) {
        const activeRes = item.reservations.find((r) => r.status === 'ACTIVE');
        const latestRes = item.reservations[0];
        const resStatus = activeRes
          ? activeRes.expiresAt <= new Date()
            ? 'EXPIRED'
            : 'ACTIVE'
          : latestRes
            ? latestRes.status
            : 'NONE';

        let keyAlias = `prod_${item.productId}`;
        for (const [alias, ref] of Object.entries(context.products)) {
          if (ref.id === item.productId) {
            keyAlias = alias;
            break;
          }
        }

        cartItemsMap[keyAlias] = {
          productId: item.productId,
          quantity: item.quantity,
          priceAtReservation: item.unitPrice.toFixed(2),
          currentPrice: item.product.price.toFixed(2),
          reservationStatus: resStatus,
          reservationQuantity: activeRes ? activeRes.quantity : 0,
        };

        cartTotalQuantity += item.quantity;
      }
    }

    // 2. Fetch Tracked Products
    const productsMap: Record<string, QaProductStateSnapshot> = {};
    for (const [alias, ref] of Object.entries(context.products)) {
      const prod = await this.prisma.product.findUnique({
        where: { id: ref.id },
      });
      if (prod) {
        const availableQuantity = prod.stockQuantity - prod.reservedQuantity;
        productsMap[alias] = {
          id: prod.id,
          stockQuantity: prod.stockQuantity,
          reservedQuantity: prod.reservedQuantity,
          availableQuantity,
          status: prod.status,
        };
      }
    }

    // 3. Fetch Orders
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    const latestOrder = orders[0];
    let latestItemCount = 0;
    let latestTotalQuantity = 0;

    if (latestOrder) {
      latestItemCount = latestOrder.items.length;
      latestTotalQuantity = latestOrder.items.reduce((sum, i) => sum + i.quantity, 0);
    }

    const latestOrderSnapshot: QaOrderStateSnapshot | null = latestOrder
      ? {
          id: latestOrder.id,
          orderNumber: latestOrder.orderNumber,
          status: latestOrder.status,
          paymentStatus: latestOrder.paymentStatus,
          totalAmount: latestOrder.totalAmount.toFixed(2),
          itemCount: latestItemCount,
          totalQuantity: latestTotalQuantity,
        }
      : null;

    // 4. Fetch Payments via Orders for User
    const payments = await this.prisma.payment.findMany({
      where: { order: { userId } },
    });

    const paidTotal = payments
      .filter((p) => p.status === PaymentStatus.PAID || p.status === PaymentStatus.PARTIALLY_REFUNDED || p.status === PaymentStatus.REFUNDED)
      .reduce((sum, p) => sum.add(p.amount), new Decimal(0));

    // 5. Fetch Refunds
    const refunds = await this.prisma.refund.findMany({
      where: { order: { userId } },
    });

    const refundedTotal = refunds
      .filter((r) => r.status === RefundStatus.SUCCEEDED)
      .reduce((sum, r) => sum.add(r.amount), new Decimal(0));

    // 6. Fetch Inventory Movements for customer's products
    const productIds = Object.values(context.products).map((p) => p.id);
    const movements = await this.prisma.inventoryMovement.findMany({
      where: { productId: { in: productIds } },
    });

    const resCount = movements.filter((m) => m.type === InventoryMovementType.RESERVATION).length;
    const saleCount = movements.filter((m) => m.type === InventoryMovementType.SALE).length;
    const restoreCount = movements.filter((m) => m.type === InventoryMovementType.CANCELLATION_RESTORE).length;

    return {
      customer: {
        id: userId,
        email: context.customerEmail,
      },
      cart: {
        id: activeCart?.id,
        status: activeCart?.status,
        version: activeCart?.version,
        itemCount: activeCart ? activeCart.items.length : 0,
        totalQuantity: cartTotalQuantity,
        items: cartItemsMap,
      },
      products: productsMap,
      orders: {
        count: orders.length,
        latest: latestOrderSnapshot,
      },
      payments: {
        count: payments.length,
        successfulTotal: paidTotal.toFixed(2),
        latestStatus: payments[0]?.status ?? null,
      },
      refunds: {
        count: refunds.length,
        successfulTotal: refundedTotal.toFixed(2),
      },
      movements: {
        totalCount: movements.length,
        byType: {
          RESERVATION: resCount,
          SALE: saleCount,
          CANCELLATION_RESTORE: restoreCount,
        },
      },
    };
  }
}
