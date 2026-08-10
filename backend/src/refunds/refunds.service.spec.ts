/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { RefundsService } from './refunds.service';
import { MockRefundGatewayService } from './mock-refund-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import {
  OrderStatus,
  PaymentStatus,
  RefundStatus,
} from '../generated/prisma/client';

describe('RefundsService', () => {
  let service: RefundsService;
  let prisma: any;
  let mockGateway: any;
  let clockService: ClockService;

  const NOW = new Date('2026-08-08T16:00:00Z');

  const mockPayment = {
    id: 5,
    orderId: 1,
    method: 'MOCK',
    status: PaymentStatus.PAID,
    amount: new Decimal('250.00'),
    provider: 'NEXACART_MOCK',
    transactionReference: 'MOCK-PAY-12345678',
    idempotencyKey: 'pay-key-1',
    paidAt: NOW,
  };

  const mockCancelledOrder = {
    id: 1,
    orderNumber: 'NXC-550E8400',
    userId: 10,
    sourceCartId: 10,
    status: OrderStatus.CANCELLED,
    paymentStatus: PaymentStatus.PAID,
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
    cancelReason: 'Changed mind',
    cancelledAt: NOW,
    placedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    items: [],
    payment: mockPayment,
    refunds: [],
  };

  const mockRefund = {
    id: 'ref-uuid-1',
    orderId: 1,
    paymentId: 5,
    amount: new Decimal('100.00'),
    status: RefundStatus.SUCCEEDED,
    idempotencyKey: 'ref-key-12345678',
    reason: 'Partial refund',
    transactionReference: 'MOCK-REF-12345678',
    createdAt: NOW,
  };

  const mockPrisma = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      update: jest.fn(),
    },
    refund: {
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
      requestId: 'req-refund-1',
      qaRunId: 'qa-run-1',
      toolCallId: 'tool-call-1',
    }),
  };

  const mockGatewayService = {
    processRefund: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        ClockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MockRefundGatewayService, useValue: mockGatewayService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RequestContextService, useValue: mockRequestContextService },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
    prisma = module.get(PrismaService);
    mockGateway = module.get(MockRefundGatewayService);
    clockService = module.get<ClockService>(ClockService);

    clockService.setSystemTime(NOW);
    jest.clearAllMocks();
  });

  afterEach(() => {
    clockService.resetSystemTime();
  });

  describe('createRefund — partial refund success', () => {
    beforeEach(() => {
      prisma.order.findUnique
        .mockResolvedValueOnce(mockCancelledOrder) // initial
        .mockResolvedValueOnce(mockCancelledOrder); // in tx
      prisma.refund.create.mockResolvedValue(mockRefund);
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.PARTIALLY_REFUNDED,
      });
      prisma.order.update.mockResolvedValue({
        ...mockCancelledOrder,
        paymentStatus: PaymentStatus.PARTIALLY_REFUNDED,
      });
      mockGateway.processRefund.mockResolvedValue({
        success: true,
        transactionReference: 'MOCK-REF-12345678',
      });
    });

    it('should process partial refund and set paymentStatus to PARTIALLY_REFUNDED', async () => {
      const result = await service.createRefund(
        10,
        'NXC-550E8400',
        { amount: '100.00', reason: 'Partial refund' },
        'ref-key-12345678',
      );

      expect(result.replayed).toBe(false);
      expect(result.refund.amount).toBe('100.00');
      expect(result.payment.status).toBe('PARTIALLY_REFUNDED');
      expect(result.payment.refundedAmount).toBe('100.00');
      expect(result.payment.remainingRefundableAmount).toBe('150.00');
    });
  });

  describe('createRefund — full refund success', () => {
    beforeEach(() => {
      prisma.order.findUnique
        .mockResolvedValueOnce(mockCancelledOrder)
        .mockResolvedValueOnce(mockCancelledOrder);
      prisma.refund.create.mockResolvedValue({
        ...mockRefund,
        amount: new Decimal('250.00'),
      });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.REFUNDED,
      });
      prisma.order.update.mockResolvedValue({
        ...mockCancelledOrder,
        paymentStatus: PaymentStatus.REFUNDED,
      });
      mockGateway.processRefund.mockResolvedValue({
        success: true,
        transactionReference: 'MOCK-REF-12345678',
      });
    });

    it('should process full refund and set paymentStatus to REFUNDED', async () => {
      const result = await service.createRefund(
        10,
        'NXC-550E8400',
        { amount: '250.00', reason: 'Full refund' },
        'ref-key-12345678',
      );

      expect(result.payment.status).toBe('REFUNDED');
      expect(result.payment.refundedAmount).toBe('250.00');
      expect(result.payment.remainingRefundableAmount).toBe('0.00');
    });
  });

  describe('createRefund — validations & error cases', () => {
    it('should reject refund when order is NOT cancelled', async () => {
      const uncancelledOrder = {
        ...mockCancelledOrder,
        status: OrderStatus.CONFIRMED,
      };

      prisma.order.findUnique
        .mockResolvedValueOnce(uncancelledOrder)
        .mockResolvedValueOnce(uncancelledOrder);

      await expect(
        service.createRefund(
          10,
          'NXC-550E8400',
          { amount: '100.00' },
          'ref-key-12345678',
        ),
      ).rejects.toMatchObject({ errorCode: 'REFUND_ORDER_NOT_CANCELLED' });
    });

    it('should reject refund when amount exceeds remaining refundable balance', async () => {
      prisma.order.findUnique
        .mockResolvedValueOnce(mockCancelledOrder)
        .mockResolvedValueOnce(mockCancelledOrder);

      await expect(
        service.createRefund(
          10,
          'NXC-550E8400',
          { amount: '300.00' },
          'ref-key-12345678',
        ),
      ).rejects.toMatchObject({ errorCode: 'REFUND_AMOUNT_EXCEEDS_PAYMENT' });
    });

    it('should reject refund when amount is negative or invalid string', async () => {
      await expect(
        service.createRefund(
          10,
          'NXC-550E8400',
          { amount: '-50.00' },
          'ref-key-12345678',
        ),
      ).rejects.toMatchObject({ errorCode: 'REFUND_AMOUNT_INVALID' });
    });

    it('should return replayed: true when same idempotency key is re-sent', async () => {
      const orderWithRefund = {
        ...mockCancelledOrder,
        refunds: [mockRefund],
      };

      prisma.order.findUnique
        .mockResolvedValueOnce(mockCancelledOrder)
        .mockResolvedValueOnce(orderWithRefund);

      const result = await service.createRefund(
        10,
        'NXC-550E8400',
        { amount: '100.00', reason: 'Partial refund' },
        'ref-key-12345678',
      );

      expect(result.replayed).toBe(true);
      expect(mockGateway.processRefund).not.toHaveBeenCalled();
    });
  });
});
