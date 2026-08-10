export interface QaCartStateItemSnapshot {
  productId: number;
  quantity: number;
  priceAtReservation: string;
  currentPrice: string;
  reservationStatus: string;
  reservationQuantity: number;
}

export interface QaProductStateSnapshot {
  id: number;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  status: string;
}

export interface QaOrderStateSnapshot {
  id: number;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  itemCount: number;
  totalQuantity: number;
}

export interface QaStateSnapshotContent {
  customer: {
    id: number;
    email: string;
  };
  cart: {
    id?: number;
    status?: string;
    version?: number;
    itemCount: number;
    totalQuantity: number;
    items: Record<string, QaCartStateItemSnapshot>; // keyed by product alias or productId
  };
  products: Record<string, QaProductStateSnapshot>; // keyed by product alias
  orders: {
    count: number;
    latest?: QaOrderStateSnapshot | null;
  };
  payments: {
    count: number;
    successfulTotal: string;
    latestStatus?: string | null;
  };
  refunds: {
    count: number;
    successfulTotal: string;
  };
  movements: {
    totalCount: number;
    byType: {
      RESERVATION: number;
      SALE: number;
      CANCELLATION_RESTORE: number;
    };
  };
}

export type StateAssertionOperator =
  | 'AFTER_EQUALS'
  | 'AFTER_NOT_EQUALS'
  | 'AFTER_EXISTS'
  | 'AFTER_NOT_EXISTS'
  | 'DELTA_EQUALS'
  | 'COUNT_DELTA_EQUALS'
  | 'UNCHANGED';

export interface ExpectedStateAssertion {
  path: string;
  operator: StateAssertionOperator;
  value?: unknown;
  valueTemplate?: string;
}
