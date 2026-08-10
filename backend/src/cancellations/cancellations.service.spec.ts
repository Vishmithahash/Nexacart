/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { CancellationsService } from './cancellations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import {
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
} from '../generated/prisma/client';

describe('CancellationsService', () => {
  let service: CancellationsService;
  let prisma: any;
  let clockService: ClockService;

  const NOW = new Date('2026-08-08T15:00:00Z');

  const mockProduct = {
    id: 1,
    sku: 'ELEC-WH-001',
    name: 'Wireless Headphones',
    stockQuantity: 7,
    reservedQuantity: 0,
    version: 2,
  };

  const mockOrder = {
    id: 1,
    orderNumber: 'NXC-550E8400',
    userId: 10,
    sourceCartId: 10,
    status: OrderStatus.CONFIRMED,
    paymentStatus: PaymentStatus.PAID,
    shipmentStatus: ShipmentStatus.NOT_READY,
    subtotal: new Decimal('250.00'),
    discountAmount: new Decimal('0.00'),
    shippingAmount: new Decimal('0.00'),
    totalAmount: new Decimal('250.00'),
    currencyCode: 'LKR',
    shippingAddress: {
      sourceAddressId: 1,
      fullName: 'Test Customer',
      phone: '+94771234567',
      addressLine1: '12 Main Road',
      addressLine2: null,
      city: 'Colombo',
      state: 'Western',
      postalCode: '00100',
      country: 'Sri Lanka',
    },
    cancelReason: null,
    cancelledAt: null,
    cancelIdempotencyKey: null,
    cancelRequestHash: null,
    placedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: 10,
        orderId: 1,
        productId: 1,
        sku: 'ELEC-WH-001',
        productName: 'Wireless Headphones',
        quantity: 3,
        unitPrice: new Decimal('83.33'),
        lineTotal: new Decimal('250.00'),
        product: mockProduct,
      },
    ],
    payment: {
      id: 5,
      status: PaymentStatus.PAID,
      amount: new Decimal('250.00'),
    },
    refunds: [],
  };

  const mockPrisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    product: {
      update: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(mockPrisma)),
  };

  const mockAuditService = {
    logInTransaction: jest.fn(),
    log: jest.fn(),
  };

  const mockRequestContextService = {
    get: jest.fn().mockReturnValue({
      requestId: 'req-cancel-1',
      qaRunId: 'qa-run-1',
      toolCallId: 'tool-call-1',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancellationsService,
        ClockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RequestContextService, useValue: mockRequestContextService },
      ],
    }).compile();

    service = module.get<CancellationsService>(CancellationsService);
    prisma = module.get(PrismaService);
    clockService = module.get<ClockService>(ClockService);

    clockService.setSystemTime(NOW);
    jest.clearAllMocks();
  });

  afterEach(() => {
    clockService.resetSystemTime();
  });

  describe('cancelOrder — success path', () => {
    it('should cancel CONFIRMED order, restore product stock, and indicate refundRequired=true', async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.product.update.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 10,
        version: 3,
      });
      prisma.inventoryMovement.create.mockResolvedValue({ id: 100 });
      prisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CANCELLED,
        cancelReason: 'Ordered by mistake',
        cancelledAt: NOW,
      });

      const result = await service.cancelOrder(
        10,
        'NXC-550E8400',
        { reason: 'Ordered by mistake' },
        'cancel-key-12345678',
      );

      expect(result.replayed).toBe(false);
      expect(result.refundRequired).toBe(true);
      expect(result.order.status).toBe('CANCELLED');

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          stockQuantity: { increment: 3 },
          version: { increment: 1 },
        },
      });

      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CANCELLATION_RESTORE',
            quantity: 3,
            stockBefore: 7,
            stockAfter: 10,
            reservedBefore: 0,
            reservedAfter: 0,
          }),
        }),
      );
    });

    it('should indicate refundRequired=false when unpaid PENDING order is cancelled', async () => {
      const unpaidOrder = {
        ...mockOrder,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
      };

      prisma.order.findUnique.mockResolvedValue(unpaidOrder);
      prisma.product.update.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 10,
        version: 3,
      });
      prisma.inventoryMovement.create.mockResolvedValue({ id: 100 });
      prisma.order.update.mockResolvedValue({
        ...unpaidOrder,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(
        10,
        'NXC-550E8400',
        { reason: 'Changed mind' },
        'cancel-key-12345678',
      );

      expect(result.refundRequired).toBe(false);
    });
  });

  describe('cancelOrder — idempotency & validation', () => {
    it('should return replayed: true when same cancellation key is re-sent', async () => {
      const requestHash = (service as any).computeCancelRequestHash(
        10,
        1,
        'Ordered by mistake',
      ) as string;
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatus.CANCELLED,
        cancelReason: 'Ordered by mistake',
        cancelledAt: NOW,
        cancelIdempotencyKey: 'cancel-key-12345678',
        cancelRequestHash: requestHash,
      };

      prisma.order.findUnique.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder(
        10,
        'NXC-550E8400',
        { reason: 'Ordered by mistake' },
        'cancel-key-12345678',
      );

      expect(result.replayed).toBe(true);
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('should throw ORDER_ALREADY_CANCELLED when trying to cancel an already cancelled order with a new key', async () => {
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatus.CANCELLED,
        cancelIdempotencyKey: 'old-cancel-key',
        cancelRequestHash: 'old-hash',
      };

      prisma.order.findUnique.mockResolvedValue(cancelledOrder);

      await expect(
        service.cancelOrder(
          10,
          'NXC-550E8400',
          { reason: 'Another reason' },
          'new-cancel-key-999',
        ),
      ).rejects.toMatchObject({ errorCode: 'ORDER_ALREADY_CANCELLED' });
    });

    it('should throw ORDER_NOT_CANCELLABLE when order is COMPLETED or SHIPPED', async () => {
      const shippedOrder = {
        ...mockOrder,
        status: OrderStatus.CONFIRMED,
        shipmentStatus: ShipmentStatus.SHIPPED,
      };

      prisma.order.findUnique.mockResolvedValue(shippedOrder);

      await expect(
        service.cancelOrder(
          10,
          'NXC-550E8400',
          { reason: 'Cancel shipped' },
          'cancel-key-12345678',
        ),
      ).rejects.toMatchObject({ errorCode: 'ORDER_NOT_CANCELLABLE' });
    });

    it('should throw ORDER_NOT_FOUND when order belongs to another customer', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...mockOrder, userId: 99 });

      await expect(
        service.cancelOrder(
          10,
          'NXC-550E8400',
          { reason: 'Cancel' },
          'cancel-key-12345678',
        ),
      ).rejects.toMatchObject({ errorCode: 'ORDER_NOT_FOUND' });
    });
  });
});
