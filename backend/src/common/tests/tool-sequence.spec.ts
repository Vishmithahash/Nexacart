/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { PaymentsService } from '../../payments/payments.service';
import { CancellationsService } from '../../cancellations/cancellations.service';
import { RefundsService } from '../../refunds/refunds.service';
import { MockPaymentGatewayService } from '../../payments/mock-payment-gateway.service';
import { MockRefundGatewayService } from '../../refunds/mock-refund-gateway.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { ClockService } from '../../common/clock/clock.service';
import {
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
} from '../../generated/prisma/client';

describe('Tool-Sequence Business Tests (Phase 6 Research Workflows)', () => {
  let paymentsService: PaymentsService;
  let cancellationsService: CancellationsService;
  let refundsService: RefundsService;
  let clockService: ClockService;

  const NOW = new Date('2026-08-08T18:00:00Z');

  // Mutable mock state for sequence tests
  let currentOrder: any;
  let currentPayment: any;
  let currentRefunds: any[];
  let currentPaymentAttempts: any[];

  const mockProduct = {
    id: 1,
    sku: 'TOOL-SEQ-001',
    name: 'Tool Sequence Widget',
    stockQuantity: 10,
    reservedQuantity: 0,
    version: 1,
  };

  const mockPrisma = {
    order: {
      findUnique: jest.fn(() => Promise.resolve(currentOrder)),
      update: jest.fn((args: any) => {
        currentOrder = { ...currentOrder, ...args.data };
        return Promise.resolve(currentOrder);
      }),
    },
    payment: {
      findUnique: jest.fn(() => Promise.resolve(currentPayment)),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(currentPayment)),
      upsert: jest.fn((args: any) => {
        currentPayment = {
          id: 1,
          orderId: currentOrder.id,
          method: 'MOCK',
          status: PaymentStatus.PAID,
          amount: currentOrder.totalAmount,
          provider: 'NEXACART_MOCK',
          transactionReference: 'MOCK-PAY-12345678',
          paidAt: NOW,
          ...args.create,
        };
        currentOrder.payment = currentPayment;
        return Promise.resolve(currentPayment);
      }),
      update: jest.fn((args: any) => {
        currentPayment = { ...currentPayment, ...args.data };
        currentOrder.payment = currentPayment;
        return Promise.resolve(currentPayment);
      }),
    },
    paymentAttempt: {
      create: jest.fn((args: any) => {
        const attempt = { id: 'attempt-uuid', ...args.data };
        currentPaymentAttempts.push(attempt);
        return Promise.resolve(attempt);
      }),
    },
    refund: {
      create: jest.fn((args: any) => {
        const refund = { id: 'refund-uuid', createdAt: NOW, ...args.data };
        currentRefunds.push(refund);
        currentOrder.refunds = currentRefunds;
        return Promise.resolve(refund);
      }),
    },
    product: {
      update: jest.fn(() =>
        Promise.resolve({ ...mockProduct, stockQuantity: 10 }),
      ),
    },
    inventoryMovement: {
      create: jest.fn(() => Promise.resolve({ id: 1 })),
    },
    $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(mockPrisma)),
  };

  const mockAuditService = {
    logInTransaction: jest.fn(),
    log: jest.fn(),
  };

  const mockRequestContextService = {
    get: jest.fn().mockReturnValue({
      requestId: 'req-seq-1',
      qaRunId: 'qa-run-seq',
      toolCallId: 'tool-call-seq',
    }),
  };

  const mockPaymentGateway = {
    processPayment: jest.fn().mockResolvedValue({
      success: true,
      transactionReference: 'MOCK-PAY-12345678',
    }),
  };

  const mockRefundGateway = {
    processRefund: jest.fn().mockResolvedValue({
      success: true,
      transactionReference: 'MOCK-REF-12345678',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        CancellationsService,
        RefundsService,
        ClockService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MockPaymentGatewayService, useValue: mockPaymentGateway },
        { provide: MockRefundGatewayService, useValue: mockRefundGateway },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RequestContextService, useValue: mockRequestContextService },
      ],
    }).compile();

    paymentsService = module.get<PaymentsService>(PaymentsService);
    cancellationsService =
      module.get<CancellationsService>(CancellationsService);
    refundsService = module.get<RefundsService>(RefundsService);
    prisma = module.get(PrismaService);
    clockService = module.get<ClockService>(ClockService);

    clockService.setSystemTime(NOW);
    jest.clearAllMocks();

    // Reset initial order state (e.g. after checkout)
    currentPayment = null;
    currentRefunds = [];
    currentPaymentAttempts = [];
    currentOrder = {
      id: 1,
      orderNumber: 'NXC-SEQ-0001',
      userId: 10,
      sourceCartId: 10,
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      shipmentStatus: ShipmentStatus.NOT_READY,
      subtotal: new Decimal('100.00'),
      discountAmount: new Decimal('0.00'),
      shippingAmount: new Decimal('0.00'),
      totalAmount: new Decimal('100.00'),
      currencyCode: 'LKR',
      shippingAddress: { sourceAddressId: 1, fullName: 'QA Agent' },
      placedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      items: [
        {
          id: 1,
          orderId: 1,
          productId: 1,
          sku: 'TOOL-SEQ-001',
          productName: 'Tool Sequence Widget',
          quantity: 1,
          unitPrice: new Decimal('100.00'),
          lineTotal: new Decimal('100.00'),
          product: mockProduct,
        },
      ],
      paymentAttempts: currentPaymentAttempts,
      payment: currentPayment,
      refunds: currentRefunds,
    };
  });

  afterEach(() => {
    clockService.resetSystemTime();
  });

  // ── Correct Sequence Test ──────────────────────────────────────────────────

  it('CORRECT WORKFLOW: checkout -> pay -> cancel -> refund MUST succeed', async () => {
    // 1. Pay order
    const payRes = await paymentsService.payOrder(
      10,
      'NXC-SEQ-0001',
      { method: 'MOCK' },
      'pay-key-seq-1',
    );
    expect(payRes.order.status).toBe('CONFIRMED');
    expect(payRes.order.paymentStatus).toBe('PAID');

    // 2. Cancel order
    const cancelRes = await cancellationsService.cancelOrder(
      10,
      'NXC-SEQ-0001',
      { reason: 'Wrong size' },
      'cancel-key-seq-1',
    );
    expect(cancelRes.order.status).toBe('CANCELLED');
    expect(cancelRes.refundRequired).toBe(true);

    // 3. Refund order
    const refundRes = await refundsService.createRefund(
      10,
      'NXC-SEQ-0001',
      { amount: '100.00', reason: 'Full refund' },
      'refund-key-seq-1',
    );
    expect(refundRes.refund.status).toBe('SUCCEEDED');
    expect(refundRes.payment.status).toBe('REFUNDED');
  });

  // ── Invalid Sequence Tests ─────────────────────────────────────────────────

  it('INVALID SEQUENCE: PAY before checkout (non-existent order) MUST fail', async () => {
    mockPrisma.order.findUnique.mockResolvedValueOnce(null);

    await expect(
      paymentsService.payOrder(
        10,
        'NXC-NON-EXISTENT',
        { method: 'MOCK' },
        'pay-key-invalid',
      ),
    ).rejects.toMatchObject({ errorCode: 'PAYMENT_ORDER_NOT_FOUND' });
  });

  it('INVALID SEQUENCE: REFUND before payment MUST fail', async () => {
    await expect(
      refundsService.createRefund(
        10,
        'NXC-SEQ-0001',
        { amount: '100.00' },
        'ref-key-invalid-1',
      ),
    ).rejects.toMatchObject({ errorCode: 'REFUND_ORDER_NOT_CANCELLED' });
  });

  it('INVALID SEQUENCE: REFUND paid order BEFORE cancellation MUST fail', async () => {
    // Pay first
    await paymentsService.payOrder(
      10,
      'NXC-SEQ-0001',
      { method: 'MOCK' },
      'pay-key-seq-2',
    );
    expect(currentOrder.status).toBe('CONFIRMED');

    // Attempt refund without cancelling first
    await expect(
      refundsService.createRefund(
        10,
        'NXC-SEQ-0001',
        { amount: '100.00' },
        'ref-key-invalid-2',
      ),
    ).rejects.toMatchObject({ errorCode: 'REFUND_ORDER_NOT_CANCELLED' });
  });

  it('INVALID SEQUENCE: PAY after cancellation (cancel -> pay) MUST fail', async () => {
    // Cancel first
    await cancellationsService.cancelOrder(
      10,
      'NXC-SEQ-0001',
      { reason: 'Cancel early' },
      'cancel-key-seq-3',
    );
    expect(currentOrder.status).toBe('CANCELLED');

    // Attempt pay on cancelled order
    await expect(
      paymentsService.payOrder(
        10,
        'NXC-SEQ-0001',
        { method: 'MOCK' },
        'pay-key-invalid-3',
      ),
    ).rejects.toMatchObject({ errorCode: 'PAYMENT_ORDER_NOT_PAYABLE' });
  });

  it('INVALID SEQUENCE: DOUBLE REFUND exceeding amount MUST fail', async () => {
    // Pay -> Cancel -> Refund 100
    await paymentsService.payOrder(
      10,
      'NXC-SEQ-0001',
      { method: 'MOCK' },
      'pay-key-seq-4',
    );
    await cancellationsService.cancelOrder(
      10,
      'NXC-SEQ-0001',
      { reason: 'Cancel' },
      'cancel-key-seq-4',
    );
    await refundsService.createRefund(
      10,
      'NXC-SEQ-0001',
      { amount: '100.00' },
      'ref-key-seq-4a',
    );

    // Second refund attempt when remaining balance is 0
    await expect(
      refundsService.createRefund(
        10,
        'NXC-SEQ-0001',
        { amount: '10.00' },
        'ref-key-seq-4b',
      ),
    ).rejects.toMatchObject({ errorCode: 'REFUND_ALREADY_COMPLETE' });
  });
});
