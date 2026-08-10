/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { PaymentsService } from './payments.service';
import { MockPaymentGatewayService } from './mock-payment-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import {
  OrderStatus,
  PaymentStatus,
  PaymentAttemptStatus,
} from '../generated/prisma/client';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let mockGateway: any;
  let clockService: ClockService;

  const NOW = new Date('2026-08-08T14:00:00Z');

  const mockOrder = {
    id: 1,
    orderNumber: 'NXC-550E8400',
    userId: 10,
    sourceCartId: 10,
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.PENDING,
    shipmentStatus: 'NOT_READY',
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
    placedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: 1,
        productId: 1,
        sku: 'ELEC-WH-001',
        productName: 'Wireless Headphones',
        quantity: 2,
        unitPrice: new Decimal('125.00'),
        lineTotal: new Decimal('250.00'),
      },
    ],
    paymentAttempts: [],
    payment: null,
  };

  const mockPayment = {
    id: 5,
    orderId: 1,
    method: 'MOCK',
    status: PaymentStatus.PAID,
    amount: new Decimal('250.00'),
    provider: 'NEXACART_MOCK',
    transactionReference: 'MOCK-PAY-12345678',
    idempotencyKey: 'pay-key-12345678',
    paidAt: NOW,
  };

  const mockPrisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      upsert: jest.fn(),
    },
    paymentAttempt: {
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
      requestId: 'req-pay-1',
      qaRunId: 'qa-run-1',
      toolCallId: 'tool-call-1',
    }),
  };

  const mockGatewayService = {
    processPayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        ClockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MockPaymentGatewayService, useValue: mockGatewayService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RequestContextService, useValue: mockRequestContextService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get(PrismaService);
    mockGateway = module.get(MockPaymentGatewayService);
    clockService = module.get<ClockService>(ClockService);

    clockService.setSystemTime(NOW);
    jest.clearAllMocks();
  });

  afterEach(() => {
    clockService.resetSystemTime();
  });

  describe('payOrder — success path', () => {
    beforeEach(() => {
      prisma.order.findUnique
        .mockResolvedValueOnce(mockOrder) // initial check
        .mockResolvedValueOnce(mockOrder); // in tx
      prisma.payment.upsert.mockResolvedValue(mockPayment);
      prisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
      });
      prisma.paymentAttempt.create.mockResolvedValue({});
      mockGateway.processPayment.mockResolvedValue({
        success: true,
        transactionReference: 'MOCK-PAY-12345678',
      });
    });

    it('should process payment and change order status PENDING -> CONFIRMED', async () => {
      const result = await service.payOrder(
        10,
        'NXC-550E8400',
        { method: 'MOCK' },
        'pay-key-12345678',
      );

      expect(result.replayed).toBe(false);
      expect(result.order.status).toBe('CONFIRMED');
      expect(result.order.paymentStatus).toBe('PAID');
      expect(result.payment.amount).toBe('250.00');
      expect(result.payment.transactionReference).toBe('MOCK-PAY-12345678');
      expect(mockGateway.processPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 1,
          orderNumber: 'NXC-550E8400',
          amount: new Decimal('250.00'),
          idempotencyKey: 'pay-key-12345678',
        }),
      );
    });

    it('should create PaymentAttempt record with SUCCEEDED status', async () => {
      await service.payOrder(
        10,
        'NXC-550E8400',
        { method: 'MOCK' },
        'pay-key-12345678',
      );

      expect(prisma.paymentAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 1,
            status: PaymentAttemptStatus.SUCCEEDED,
            idempotencyKey: 'pay-key-12345678',
            amount: new Decimal('250.00'),
            transactionReference: 'MOCK-PAY-12345678',
          }),
        }),
      );
    });
  });

  describe('payOrder — idempotency replay', () => {
    it('should return replayed: true when same idempotency key is reused', async () => {
      const orderWithAttempt = {
        ...mockOrder,
        paymentAttempts: [
          {
            id: 'attempt-uuid-1',
            orderId: 1,
            status: PaymentAttemptStatus.SUCCEEDED,
            idempotencyKey: 'pay-key-12345678',
          },
        ],
      };

      prisma.order.findUnique
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(orderWithAttempt);
      prisma.payment.findUniqueOrThrow.mockResolvedValue(mockPayment);

      const result = await service.payOrder(
        10,
        'NXC-550E8400',
        { method: 'MOCK' },
        'pay-key-12345678',
      );

      expect(result.replayed).toBe(true);
      expect(result.order.status).toBe('PENDING'); // or mapped
      expect(mockGateway.processPayment).not.toHaveBeenCalled();
    });

    it('should throw PAYMENT_ALREADY_PAID when paid under a different idempotency key', async () => {
      const paidOrder = {
        ...mockOrder,
        paymentStatus: PaymentStatus.PAID,
        paymentAttempts: [], // no attempt with this new key
      };

      prisma.order.findUnique
        .mockResolvedValueOnce(paidOrder)
        .mockResolvedValueOnce(paidOrder);

      await expect(
        service.payOrder(
          10,
          'NXC-550E8400',
          { method: 'MOCK' },
          'different-key-9999',
        ),
      ).rejects.toMatchObject({ errorCode: 'PAYMENT_ALREADY_PAID' });
    });
  });

  describe('payOrder — failure handling', () => {
    it('should record failed attempt and not confirm order when gateway fails', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(mockOrder);
      prisma.order.update.mockResolvedValue({});
      prisma.paymentAttempt.create.mockResolvedValue({});
      mockGateway.processPayment.mockResolvedValue({
        success: false,
        transactionReference: '',
        failureReason: 'Insufficient mock funds',
      });

      await expect(
        service.payOrder(
          10,
          'NXC-550E8400',
          { method: 'MOCK' },
          'pay-key-12345678',
        ),
      ).rejects.toMatchObject({ errorCode: 'PAYMENT_PROCESSING_FAILED' });

      expect(prisma.paymentAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentAttemptStatus.FAILED,
            failureReason: 'Insufficient mock funds',
          }),
        }),
      );
    });

    it('should reject when order does not belong to customer', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...mockOrder, userId: 99 });

      await expect(
        service.payOrder(
          10,
          'NXC-550E8400',
          { method: 'MOCK' },
          'pay-key-12345678',
        ),
      ).rejects.toMatchObject({ errorCode: 'PAYMENT_ORDER_NOT_FOUND' });
    });

    it('should reject when idempotency key is missing or short', async () => {
      await expect(
        service.payOrder(10, 'NXC-550E8400', { method: 'MOCK' }, undefined),
      ).rejects.toMatchObject({
        errorCode: 'PAYMENT_IDEMPOTENCY_KEY_REQUIRED',
      });

      await expect(
        service.payOrder(10, 'NXC-550E8400', { method: 'MOCK' }, 'short'),
      ).rejects.toMatchObject({
        errorCode: 'PAYMENT_IDEMPOTENCY_KEY_REQUIRED',
      });
    });
  });
});
