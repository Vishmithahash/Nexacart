import { Decimal } from '@prisma/client/runtime/client';

export interface OrderItemResponse {
  id: number;
  productId: number;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface OrderShippingAddressSnapshot {
  sourceAddressId: number;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
}

export interface OrderPaymentInfo {
  id: number;
  method: string;
  status: string;
  amount: string;
  provider: string | null;
  transactionReference: string | null;
  paidAt: Date | null;
}

export interface OrderRefundInfo {
  id: string;
  amount: string;
  status: string;
  reason: string | null;
  transactionReference: string | null;
  createdAt: Date;
}

export interface OrderResponse {
  id: number;
  orderNumber: string;
  userId: number;
  sourceCartId: number | null;
  status: string;
  paymentStatus: string;
  shipmentStatus: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  totalAmount: string;
  currencyCode: string;
  shippingAddress: OrderShippingAddressSnapshot;
  items: OrderItemResponse[];
  payment?: OrderPaymentInfo | null;
  refunds?: OrderRefundInfo[];
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  placedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Maps a raw Prisma order with included items to a safe API response. */
export function mapOrderToResponse(order: {
  id: number;
  orderNumber: string;
  userId: number;
  sourceCartId: number | null;
  status: string;
  paymentStatus: string;
  shipmentStatus: string;
  subtotal: Decimal;
  discountAmount: Decimal;
  shippingAmount: Decimal;
  totalAmount: Decimal;
  currencyCode: string;
  shippingAddress: unknown;
  cancelledAt?: Date | null;
  cancelReason?: string | null;
  placedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: number;
    productId: number;
    sku: string;
    productName: string;
    quantity: number;
    unitPrice: Decimal;
    lineTotal: Decimal;
  }>;
  payment?: {
    id: number;
    method: string;
    status: string;
    amount: Decimal;
    provider: string | null;
    transactionReference: string | null;
    paidAt: Date | null;
  } | null;
  refunds?: Array<{
    id: string;
    amount: Decimal;
    status: string;
    reason: string | null;
    transactionReference: string | null;
    createdAt: Date;
  }>;
}): OrderResponse {
  const mapped: OrderResponse = {
    id: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    sourceCartId: order.sourceCartId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    shipmentStatus: order.shipmentStatus,
    subtotal: order.subtotal.toFixed(2),
    discountAmount: order.discountAmount.toFixed(2),
    shippingAmount: order.shippingAmount.toFixed(2),
    totalAmount: order.totalAmount.toFixed(2),
    currencyCode: order.currencyCode,
    shippingAddress: order.shippingAddress as OrderShippingAddressSnapshot,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
    })),
    placedAt: order.placedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };

  if (order.payment) {
    mapped.payment = {
      id: order.payment.id,
      method: order.payment.method,
      status: order.payment.status,
      amount: order.payment.amount.toFixed(2),
      provider: order.payment.provider,
      transactionReference: order.payment.transactionReference,
      paidAt: order.payment.paidAt,
    };
  }

  if (order.refunds) {
    mapped.refunds = order.refunds.map((r) => ({
      id: r.id,
      amount: r.amount.toFixed(2),
      status: r.status,
      reason: r.reason,
      transactionReference: r.transactionReference,
      createdAt: r.createdAt,
    }));
  }

  if (order.cancelledAt !== undefined) {
    mapped.cancelledAt = order.cancelledAt;
  }

  if (order.cancelReason !== undefined) {
    mapped.cancelReason = order.cancelReason;
  }

  return mapped;
}
