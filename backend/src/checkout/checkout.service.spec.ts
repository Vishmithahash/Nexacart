/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import {
  AddressType,
  CartMutationType,
  CartStatus,
  InventoryReservationStatus,
  ProductStatus,
} from '../generated/prisma/client';

describe('CheckoutService', () => {
  let service: CheckoutService;
  let prisma: any;
  let clockService: ClockService;

  const NOW = new Date('2026-08-08T12:00:00Z');
  const EXPIRES_AT = new Date('2026-08-08T12:30:00Z'); // 30min from now

  const mockAddress = {
    id: 1,
    userId: 10,
    type: AddressType.SHIPPING,
    fullName: 'Test Customer',
    phone: '+94771234567',
    addressLine1: '12 Main Road',
    addressLine2: null,
    city: 'Colombo',
    state: 'Western Province',
    postalCode: '00100',
    country: 'Sri Lanka',
  };

  const mockProduct = {
    id: 1,
    sku: 'ELEC-WH-001',
    name: 'Wireless Headphones',
    price: new Decimal('89.99'),
    currencyCode: 'LKR',
    stockQuantity: 10,
    reservedQuantity: 3,
    status: ProductStatus.ACTIVE,
    category: { id: 1, isActive: true },
  };

  const mockCartItem = {
    id: 100,
    productId: 1,
    quantity: 3,
    unitPrice: new Decimal('89.99'),
    createdAt: new Date(),
    updatedAt: new Date(),
    product: mockProduct,
    reservations: [
      {
        id: 'res-uuid-1',
        quantity: 3,
        status: InventoryReservationStatus.ACTIVE,
        expiresAt: EXPIRES_AT,
        releasedAt: null,
        releaseReason: null,
        consumedAt: null,
      },
    ],
  };

  const mockCart = {
    id: 10,
    userId: 10,
    status: CartStatus.ACTIVE,
    version: 2,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [mockCartItem],
  };

  const mockOrder = {
    id: 1,
    orderNumber: 'NXC-ABCD1234',
    userId: 10,
    sourceCartId: 10,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    shipmentStatus: 'NOT_READY',
    subtotal: new Decimal('269.97'),
    discountAmount: new Decimal('0.00'),
    shippingAmount: new Decimal('0.00'),
    totalAmount: new Decimal('269.97'),
    currencyCode: 'LKR',
    shippingAddress: {
      sourceAddressId: 1,
      fullName: 'Test Customer',
      phone: '+94771234567',
      addressLine1: '12 Main Road',
      addressLine2: null,
      city: 'Colombo',
      state: 'Western Province',
      postalCode: '00100',
      country: 'Sri Lanka',
    },
    placedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: 1,
        productId: 1,
        sku: 'ELEC-WH-001',
        productName: 'Wireless Headphones',
        quantity: 3,
        unitPrice: new Decimal('89.99'),
        lineTotal: new Decimal('269.97'),
      },
    ],
  };

  const mockPrisma = {
    cart: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    orderItem: {
      create: jest.fn(),
    },
    product: {
      updateManyAndReturn: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    inventoryReservation: {
      update: jest.fn(),
    },
    cartMutation: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    address: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(mockPrisma)),
  };

  const mockAuditService = {
    logInTransaction: jest.fn(),
    log: jest.fn(),
  };

  const mockRequestContextService = {
    get: jest.fn().mockReturnValue({
      requestId: 'req-1',
      qaRunId: 'qa-run-1',
      toolCallId: 'tool-call-1',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        ClockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RequestContextService, useValue: mockRequestContextService },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
    prisma = module.get(PrismaService);
    clockService = module.get<ClockService>(ClockService);

    clockService.setSystemTime(NOW);
    jest.clearAllMocks();
  });

  afterEach(() => {
    clockService.resetSystemTime();
  });

  // ── Successful Checkout ────────────────────────────────────────────────────

  describe('checkout — success path', () => {
    beforeEach(() => {
      prisma.cart.findFirst
        .mockResolvedValueOnce(mockCart) // pre-tx lookup
        .mockResolvedValueOnce(mockCart); // inside tx
      prisma.cartMutation.findUnique.mockResolvedValue(null);
      prisma.address.findFirst.mockResolvedValue(mockAddress);
      prisma.order.create.mockResolvedValue(mockOrder);
      prisma.orderItem.create.mockResolvedValue(mockOrder.items[0]);
      prisma.product.updateManyAndReturn.mockResolvedValue([{ id: 1 }]);
      prisma.inventoryMovement.create.mockResolvedValue({ id: 1 });
      prisma.inventoryReservation.update.mockResolvedValue({});
      prisma.cart.update.mockResolvedValue({
        ...mockCart,
        status: CartStatus.CONVERTED,
      });
      prisma.cartMutation.create.mockResolvedValue({});
    });

    it('should create an order and return replayed: false for first checkout', async () => {
      const result = await service.checkout(
        10,
        { shippingAddressId: 1, expectedCartVersion: 2 },
        'idempotency-key-1234',
      );

      expect(result.replayed).toBe(false);
      expect(result.order.status).toBe('PENDING');
      expect(result.order.paymentStatus).toBe('PENDING');
      expect(result.order.shipmentStatus).toBe('NOT_READY');
      expect(result.order.subtotal).toBe('269.97');
      expect(result.order.totalAmount).toBe('269.97');
      expect(result.order.currencyCode).toBe('LKR');
      expect(result.order.sourceCartId).toBe(10);
    });

    it('should create correct inventory SALE movement', async () => {
      await service.checkout(
        10,
        { shippingAddressId: 1, expectedCartVersion: 2 },
        'idempotency-key-1234',
      );

      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'SALE',
            quantity: 3,
            stockBefore: 10,
            stockAfter: 7,
            reservedBefore: 3,
            reservedAfter: 0,
          }),
        }),
      );
    });

    it('should mark reservation as CONSUMED', async () => {
      await service.checkout(
        10,
        { shippingAddressId: 1, expectedCartVersion: 2 },
        'idempotency-key-1234',
      );

      expect(prisma.inventoryReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'res-uuid-1' },
          data: expect.objectContaining({
            status: InventoryReservationStatus.CONSUMED,
            consumedAt: NOW,
          }),
        }),
      );
    });

    it('should convert cart to CONVERTED', async () => {
      await service.checkout(
        10,
        { shippingAddressId: 1, expectedCartVersion: 2 },
        'idempotency-key-1234',
      );

      expect(prisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            status: CartStatus.CONVERTED,
          }),
        }),
      );
    });

    it('should create CartMutation with CHECKOUT type', async () => {
      await service.checkout(
        10,
        { shippingAddressId: 1, expectedCartVersion: 2 },
        'idempotency-key-1234',
      );

      expect(prisma.cartMutation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: CartMutationType.CHECKOUT,
            idempotencyKey: 'idempotency-key-1234',
          }),
        }),
      );
    });

    it('should store shipping address snapshot in order', async () => {
      const result = await service.checkout(
        10,
        { shippingAddressId: 1, expectedCartVersion: 2 },
        'idempotency-key-1234',
      );

      expect(result.order.shippingAddress).toMatchObject({
        sourceAddressId: 1,
        fullName: 'Test Customer',
        city: 'Colombo',
        country: 'Sri Lanka',
      });
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  describe('checkout — idempotency', () => {
    it('should return replayed: true when same key and hash is replayed', async () => {
      const requestHash = (service as any).computeRequestHash(
        10,
        10,
        1,
        2,
      ) as string;
      prisma.cart.findFirst.mockResolvedValue(mockCart);
      prisma.cartMutation.findUnique.mockResolvedValue({
        requestHash,
        responseBody: { orderId: 1 },
      });
      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await service.checkout(
        10,
        { shippingAddressId: 1, expectedCartVersion: 2 },
        'idempotency-key-1234',
      );

      expect(result.replayed).toBe(true);
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.product.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('should reject with CHECKOUT_IDEMPOTENCY_CONFLICT when key reused with different data', async () => {
      prisma.cart.findFirst.mockResolvedValue(mockCart);
      prisma.cartMutation.findUnique.mockResolvedValue({
        requestHash: 'different-hash-abc123',
        responseBody: { orderId: 1 },
      });

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_IDEMPOTENCY_CONFLICT' });
    });
  });

  // ── Validation Rejections ─────────────────────────────────────────────────

  describe('checkout — validation rejections', () => {
    it('should reject when idempotency key is missing', async () => {
      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          undefined,
        ),
      ).rejects.toMatchObject({
        errorCode: 'CHECKOUT_IDEMPOTENCY_KEY_REQUIRED',
      });
    });

    it('should reject when idempotency key is too short', async () => {
      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'short',
        ),
      ).rejects.toMatchObject({
        errorCode: 'CHECKOUT_IDEMPOTENCY_KEY_REQUIRED',
      });
    });

    it('should reject when no active cart found', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_CART_NOT_FOUND' });
    });

    it('should reject when cart version is stale', async () => {
      prisma.cart.findFirst
        .mockResolvedValueOnce(mockCart) // pre-tx lookup
        .mockResolvedValueOnce(mockCart); // inside tx
      prisma.cartMutation.findUnique.mockResolvedValue(null);

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 999 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_CART_CHANGED' });
    });

    it('should reject when cart is empty', async () => {
      const emptyCart = { ...mockCart, items: [] };
      prisma.cart.findFirst
        .mockResolvedValueOnce(emptyCart)
        .mockResolvedValueOnce(emptyCart);
      prisma.cartMutation.findUnique.mockResolvedValue(null);

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_CART_EMPTY' });
    });

    it('should reject when shipping address not found or not owned', async () => {
      prisma.cart.findFirst
        .mockResolvedValueOnce(mockCart)
        .mockResolvedValueOnce(mockCart);
      prisma.cartMutation.findUnique.mockResolvedValue(null);
      prisma.address.findFirst.mockResolvedValue(null); // not found or wrong user

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 99, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({
        errorCode: 'CHECKOUT_SHIPPING_ADDRESS_NOT_FOUND',
      });
    });

    it('should reject when reservation is missing for a cart item', async () => {
      const itemWithNoReservation = { ...mockCartItem, reservations: [] };
      const cartWithNoReservation = {
        ...mockCart,
        items: [itemWithNoReservation],
      };

      prisma.cart.findFirst
        .mockResolvedValueOnce(cartWithNoReservation)
        .mockResolvedValueOnce(cartWithNoReservation);
      prisma.cartMutation.findUnique.mockResolvedValue(null);
      prisma.address.findFirst.mockResolvedValue(mockAddress);

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_RESERVATION_MISSING' });
    });

    it('should reject when reservation is expired', async () => {
      const expiredAt = new Date('2026-08-08T11:00:00Z'); // before NOW
      const itemWithExpiredReservation = {
        ...mockCartItem,
        reservations: [
          { ...mockCartItem.reservations[0], expiresAt: expiredAt },
        ],
      };
      const cartWithExpiredReservation = {
        ...mockCart,
        items: [itemWithExpiredReservation],
      };

      prisma.cart.findFirst
        .mockResolvedValueOnce(cartWithExpiredReservation)
        .mockResolvedValueOnce(cartWithExpiredReservation);
      prisma.cartMutation.findUnique.mockResolvedValue(null);
      prisma.address.findFirst.mockResolvedValue(mockAddress);

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_RESERVATION_EXPIRED' });
    });

    it('should reject when reservation quantity does not match cart item quantity', async () => {
      const itemWithMismatch = {
        ...mockCartItem,
        quantity: 3,
        reservations: [{ ...mockCartItem.reservations[0], quantity: 2 }], // mismatch
      };
      const cartWithMismatch = { ...mockCart, items: [itemWithMismatch] };

      prisma.cart.findFirst
        .mockResolvedValueOnce(cartWithMismatch)
        .mockResolvedValueOnce(cartWithMismatch);
      prisma.cartMutation.findUnique.mockResolvedValue(null);
      prisma.address.findFirst.mockResolvedValue(mockAddress);

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_RESERVATION_MISMATCH' });
    });

    it('should reject with CHECKOUT_INVENTORY_CONFLICT when guarded product update returns empty', async () => {
      prisma.cart.findFirst
        .mockResolvedValueOnce(mockCart)
        .mockResolvedValueOnce(mockCart);
      prisma.cartMutation.findUnique.mockResolvedValue(null);
      prisma.address.findFirst.mockResolvedValue(mockAddress);
      prisma.order.create.mockResolvedValue(mockOrder);
      prisma.orderItem.create.mockResolvedValue(mockOrder.items[0]);
      prisma.product.updateManyAndReturn.mockResolvedValue([]); // no rows updated = conflict

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toMatchObject({ errorCode: 'CHECKOUT_INVENTORY_CONFLICT' });
    });
  });

  // ── Atomicity ─────────────────────────────────────────────────────────────

  describe('checkout — atomicity', () => {
    it('should not create order or consume inventory when validation fails', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await expect(
        service.checkout(
          10,
          { shippingAddressId: 1, expectedCartVersion: 2 },
          'idempotency-key-1234',
        ),
      ).rejects.toBeDefined();

      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(prisma.product.updateManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.inventoryReservation.update).not.toHaveBeenCalled();
      expect(prisma.cart.update).not.toHaveBeenCalled();
    });
  });
});
