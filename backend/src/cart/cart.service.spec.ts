/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/client';
import { CartService } from './cart.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import {
  CartStatus,
  InventoryReservationStatus,
  ProductStatus,
} from '../generated/prisma/client';

describe('CartService', () => {
  let service: CartService;
  let prisma: any;
  let clockService: ClockService;

  const mockProduct = {
    id: 1,
    sku: 'ELEC-WH-001',
    name: 'Wireless Headphones',
    price: new Decimal('89.99'),
    currencyCode: 'LKR',
    stockQuantity: 100,
    reservedQuantity: 0,
    status: ProductStatus.ACTIVE,
    category: { id: 1, isActive: true },
  };

  const mockCart = {
    id: 10,
    userId: 1,
    status: CartStatus.ACTIVE,
    version: 1,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  };

  const mockPrismaService = {
    cart: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    cartItem: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    inventoryReservation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    cartMutation: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockAuditService = {
    logInTransaction: jest.fn(),
    log: jest.fn(),
  };

  const mockRequestContextService = {
    get: jest.fn().mockReturnValue({
      requestId: 'req-1',
      qaRunId: 'qa-1',
      toolCallId: 'tool-1',
    }),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: any) => defaultValue),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        ClockService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RequestContextService, useValue: mockRequestContextService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    prisma = module.get(PrismaService);
    clockService = module.get<ClockService>(ClockService);
    jest.clearAllMocks();
  });

  describe('getActiveCart', () => {
    it('should create new active cart if none exists and return empty cart summary', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);
      prisma.cart.create.mockResolvedValue(mockCart);
      prisma.inventoryReservation.findMany.mockResolvedValue([]);
      prisma.cart.findUniqueOrThrow.mockResolvedValue(mockCart);

      const res = await service.getActiveCart(1);

      expect(res.status).toBe('ACTIVE');
      expect(res.version).toBe(1);
      expect(res.summary.distinctItems).toBe(0);
      expect(res.summary.subtotal).toBe('0.00');
    });

    it('should return existing active cart with items and price snapshot comparison', async () => {
      const cartWithItem = {
        ...mockCart,
        items: [
          {
            id: 100,
            productId: 1,
            quantity: 2,
            unitPrice: new Decimal('89.99'),
            createdAt: new Date(),
            updatedAt: new Date(),
            product: mockProduct,
            reservations: [
              {
                id: 'res-1',
                quantity: 2,
                status: InventoryReservationStatus.ACTIVE,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                releasedAt: null,
                releaseReason: null,
              },
            ],
          },
        ],
      };

      prisma.cart.findFirst.mockResolvedValue(cartWithItem);
      prisma.inventoryReservation.findMany.mockResolvedValue([]);
      prisma.cart.findUniqueOrThrow.mockResolvedValue(cartWithItem);

      const res = await service.getActiveCart(1);

      expect(res.items).toHaveLength(1);
      expect(res.items[0].priceAtReservation).toBe('89.99');
      expect(res.items[0].currentPrice).toBe('89.99');
      expect(res.items[0].priceChanged).toBe(false);
      expect(res.summary.subtotal).toBe('179.98');
    });
  });

  describe('addItem', () => {
    it('should add item, reserve stock, and record mutation and audit log', async () => {
      prisma.cartMutation.findUnique.mockResolvedValue(null); // not replayed
      prisma.product.findUnique.mockResolvedValue(mockProduct);
      prisma.cart.findFirst.mockResolvedValue(mockCart);

      prisma.product.update.mockResolvedValue({
        ...mockProduct,
        reservedQuantity: 2,
      });

      prisma.cartItem.create.mockResolvedValue({
        id: 100,
        cartId: 10,
        productId: 1,
        quantity: 2,
        unitPrice: new Decimal('89.99'),
      });

      const updatedCart = {
        ...mockCart,
        version: 2,
        items: [
          {
            id: 100,
            productId: 1,
            quantity: 2,
            unitPrice: new Decimal('89.99'),
            createdAt: new Date(),
            updatedAt: new Date(),
            product: { ...mockProduct, reservedQuantity: 2 },
            reservations: [
              {
                id: 'res-1',
                quantity: 2,
                status: InventoryReservationStatus.ACTIVE,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                releasedAt: null,
                releaseReason: null,
              },
            ],
          },
        ],
      };

      prisma.cart.update.mockResolvedValue(updatedCart);

      const dto = { productId: 1, quantity: 2, expectedCartVersion: 1 };
      const { body, replayed } = await service.addItem(1, dto, 'key-12345678');

      expect(replayed).toBe(false);
      expect(body.version).toBe(2);
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RESERVATION',
            quantity: 2,
          }),
        }),
      );
    });

    it('should return replayed: true for duplicate idempotency key with identical hash', async () => {
      const mockMutation = {
        userId: 1,
        type: 'ADD_ITEM',
        idempotencyKey: 'key-12345678',
        requestHash:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // dummy hash
        responseBody: {
          id: 10,
          status: 'ACTIVE',
          version: 2,
          items: [],
          summary: { subtotal: '0.00' },
        },
      };

      // Mock request hash matching
      jest
        .spyOn(service as any, 'computeRequestHash')
        .mockReturnValue(
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        );
      prisma.cartMutation.findUnique.mockResolvedValue(mockMutation);

      const dto = { productId: 1, quantity: 2, expectedCartVersion: 1 };
      const { body, replayed } = await service.addItem(1, dto, 'key-12345678');

      expect(replayed).toBe(true);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('should reject with 409 CART_IDEMPOTENCY_CONFLICT when key is reused with different hash', async () => {
      const mockMutation = {
        userId: 1,
        type: 'ADD_ITEM',
        idempotencyKey: 'key-12345678',
        requestHash: 'different-hash',
      };

      prisma.cartMutation.findUnique.mockResolvedValue(mockMutation);

      const dto = { productId: 1, quantity: 2, expectedCartVersion: 1 };
      await expect(
        service.addItem(1, dto, 'key-12345678'),
      ).rejects.toMatchObject({
        errorCode: 'CART_IDEMPOTENCY_CONFLICT',
      });
    });
  });
});
