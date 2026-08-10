import { Decimal } from '@prisma/client/runtime/client';
import { InventoryReservationStatus } from '../generated/prisma/client';

export interface CartItemReservationResponse {
  id: string | null;
  status: InventoryReservationStatus | 'NONE';
  quantity: number;
  expiresAt: Date | null;
  releasedAt: Date | null;
  releaseReason: string | null;
}

export interface CartItemResponse {
  id: number;
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  priceAtReservation: string;
  currentPrice: string;
  priceChanged: boolean;
  lineTotal: string;
  availableStock: number;
  canAttemptReservation: boolean;
  reservation: CartItemReservationResponse;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartSummaryResponse {
  distinctItems: number;
  totalQuantity: number;
  subtotal: string;
  currencyCode: string;
  hasExpiredReservations: boolean;
  hasPriceChanges: boolean;
}

export interface CartResponse {
  id: number;
  status: string;
  version: number;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
  items: CartItemResponse[];
  summary: CartSummaryResponse;
}

export function mapCartToResponse(
  cart: {
    id: number;
    status: string;
    version: number;
    lastActivityAt: Date;
    createdAt: Date;
    updatedAt: Date;
    items: Array<{
      id: number;
      productId: number;
      quantity: number;
      unitPrice: Decimal;
      createdAt: Date;
      updatedAt: Date;
      product: {
        id: number;
        sku: string;
        name: string;
        price: Decimal;
        currencyCode: string;
        stockQuantity: number;
        reservedQuantity: number;
      };
      reservations: Array<{
        id: string;
        quantity: number;
        status: InventoryReservationStatus;
        expiresAt: Date;
        releasedAt: Date | null;
        releaseReason: string | null;
      }>;
    }>;
  },
  now: Date,
): CartResponse {
  // Sort items deterministically: createdAt ascending, id ascending
  const sortedItems = [...cart.items].sort((a, b) => {
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    return timeDiff !== 0 ? timeDiff : a.id - b.id;
  });

  let subtotalDecimal = new Decimal(0);
  let totalQuantity = 0;
  let hasExpiredReservations = false;
  let hasPriceChanges = false;
  let currencyCode = 'LKR';

  const mappedItems: CartItemResponse[] = sortedItems.map((item) => {
    if (item.product.currencyCode) {
      currencyCode = item.product.currencyCode;
    }

    const priceAtReservationStr = item.unitPrice.toFixed(2);
    const currentPriceStr = item.product.price.toFixed(2);
    const priceChanged = priceAtReservationStr !== currentPriceStr;
    if (priceChanged) {
      hasPriceChanges = true;
    }

    const lineTotalDecimal = item.unitPrice.mul(item.quantity);
    subtotalDecimal = subtotalDecimal.add(lineTotalDecimal);
    totalQuantity += item.quantity;

    // Find active or latest reservation
    const activeReservation = item.reservations.find(
      (r) => r.status === InventoryReservationStatus.ACTIVE,
    );

    let reservationStatus: InventoryReservationStatus | 'NONE' = 'NONE';
    let reservedQuantity = 0;
    let reservationId: string | null = null;
    let expiresAt: Date | null = null;
    let releasedAt: Date | null = null;
    let releaseReason: string | null = null;

    if (activeReservation) {
      // Check if dynamically expired against now
      if (activeReservation.expiresAt <= now) {
        reservationStatus = InventoryReservationStatus.EXPIRED;
        hasExpiredReservations = true;
        reservedQuantity = 0;
      } else {
        reservationStatus = InventoryReservationStatus.ACTIVE;
        reservedQuantity = activeReservation.quantity;
      }
      reservationId = activeReservation.id;
      expiresAt = activeReservation.expiresAt;
      releasedAt = activeReservation.releasedAt;
      releaseReason = activeReservation.releaseReason;
    } else if (item.reservations.length > 0) {
      // Sort reservations by createdAt desc to find most recent status
      const latest = item.reservations[0];
      reservationStatus = latest.status;
      if (reservationStatus === InventoryReservationStatus.EXPIRED) {
        hasExpiredReservations = true;
      }
      reservationId = latest.id;
      expiresAt = latest.expiresAt;
      releasedAt = latest.releasedAt;
      releaseReason = latest.releaseReason;
    }

    const availableStock =
      item.product.stockQuantity - item.product.reservedQuantity;
    const canAttemptReservation = availableStock >= item.quantity;

    return {
      id: item.id,
      productId: item.productId,
      sku: item.product.sku,
      name: item.product.name,
      quantity: item.quantity,
      priceAtReservation: priceAtReservationStr,
      currentPrice: currentPriceStr,
      priceChanged,
      lineTotal: lineTotalDecimal.toFixed(2),
      availableStock,
      canAttemptReservation,
      reservation: {
        id: reservationId,
        status: reservationStatus,
        quantity: reservedQuantity,
        expiresAt,
        releasedAt,
        releaseReason,
      },
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });

  return {
    id: cart.id,
    status: cart.status,
    version: cart.version,
    lastActivityAt: cart.lastActivityAt,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
    items: mappedItems,
    summary: {
      distinctItems: mappedItems.length,
      totalQuantity,
      subtotal: subtotalDecimal.toFixed(2),
      currencyCode,
      hasExpiredReservations,
      hasPriceChanges,
    },
  };
}
