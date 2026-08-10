export interface QaFixtureProductRef {
  id: number;
  sku: string;
  name: string;
  price: string;
  stockQuantity: number;
  reservedQuantity: number;
}

export interface QaFixtureContext {
  customerId: number;
  customerEmail: string;
  shippingAddressId?: number;
  products: Record<string, QaFixtureProductRef>;
  cartId?: number;
  cartVersion?: number;
  orderId?: number;
  orderNumber?: string;
  [key: string]: unknown;
}
