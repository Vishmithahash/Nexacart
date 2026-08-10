import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import { ApiException } from '../common/exceptions/api.exception';
import {
  PaymentMethod,
  PaymentStatus,
  OrderStatus,
  PaymentAttemptStatus,
} from '../generated/prisma/client';
import { MockPaymentGatewayService } from './mock-payment-gateway.service';
import { PayOrderDto } from './dto/pay-order.dto';
import { mapOrderToResponse, OrderResponse } from '../orders/order.mapper';

export interface PaymentInfoResponse {
  id: number;
  orderNumber: string;
  method: string;
  status: string;
  amount: string;
  provider: string;
  transactionReference: string;
  paidAt: Date | null;
}

export interface PayOrderResult {
  replayed: boolean;
  payment: PaymentInfoResponse;
  order: OrderResponse;
}

const MAX_RETRIES = 3;
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';
const PRISMA_SERIALIZATION_CODE = 'P2034';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mockGateway: MockPaymentGatewayService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly clockService: ClockService,
  ) {}

  async payOrder(
    userId: number,
    orderNumber: string,
    dto: PayOrderDto,
    rawIdempotencyKey: string | undefined,
  ): Promise<PayOrderResult> {
    // 1. Validate idempotency key
    if (!rawIdempotencyKey) {
      throw ApiException.paymentIdempotencyKeyRequired();
    }
    const idempotencyKey = rawIdempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw ApiException.paymentIdempotencyKeyRequired();
    }

    // 2. Initial order & ownership check
    const existingOrder = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: { payment: true, items: true },
    });

    if (!existingOrder || existingOrder.userId !== userId) {
      throw ApiException.paymentOrderNotFound();
    }

    // 3. Retry loop for serializable transactions
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.executePaymentTransaction(
          userId,
          existingOrder.id,
          dto,
          idempotencyKey,
        );
      } catch (err: unknown) {
        const pgCode = this.extractPgCode(err);
        if (
          pgCode === PG_SERIALIZATION_FAILURE ||
          pgCode === PG_DEADLOCK_DETECTED ||
          pgCode === PRISMA_SERIALIZATION_CODE
        ) {
          this.logger.warn(
            `Payment transaction serialization conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`,
          );
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  private async executePaymentTransaction(
    userId: number,
    orderId: number,
    dto: PayOrderDto,
    idempotencyKey: string,
  ): Promise<PayOrderResult> {
    const now = this.clockService.now();
    const ctx = this.requestContext.get();

    return this.prisma.$transaction(
      async (tx) => {
        // Step A: Load order with payment and attempts within transaction
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            payment: true,
            items: { orderBy: { id: 'asc' } },
            paymentAttempts: {
              where: { idempotencyKey },
            },
          },
        });

        if (!order || order.userId !== userId) {
          throw ApiException.paymentOrderNotFound();
        }

        // Step B: Check existing attempt with same idempotency key for replay
        const existingAttempt = order.paymentAttempts[0];
        if (existingAttempt) {
          if (existingAttempt.status === PaymentAttemptStatus.SUCCEEDED) {
            const payment = await tx.payment.findUniqueOrThrow({
              where: { orderId: order.id },
            });
            await this.auditService.logInTransaction(
              {
                userId,
                action: 'PAYMENT_REPLAYED',
                entityType: 'Payment',
                entityId: String(payment.id),
                success: true,
                metadata: {
                  orderId: order.id,
                  orderNumber: order.orderNumber,
                  idempotencyKey,
                  replayed: true,
                },
              },
              tx,
            );
            return {
              replayed: true,
              payment: this.mapPaymentToResponse(payment, order.orderNumber),
              order: mapOrderToResponse(order),
            };
          } else {
            throw ApiException.paymentProcessingFailed(
              existingAttempt.failureReason ??
                'Previous payment attempt with this key failed.',
            );
          }
        }

        // Step C: Check if order is already paid under a different idempotency key
        if (order.paymentStatus === PaymentStatus.PAID) {
          throw ApiException.paymentAlreadyPaid();
        }

        // Step D: Validate order is payable
        if (
          order.status === OrderStatus.CANCELLED ||
          order.status === OrderStatus.COMPLETED
        ) {
          throw ApiException.paymentOrderNotPayable(
            'Cannot pay a cancelled or completed order.',
          );
        }

        if (order.status !== OrderStatus.PENDING) {
          throw ApiException.paymentOrderNotPayable(
            `Order is in ${order.status} state, expected PENDING.`,
          );
        }

        if (order.totalAmount.lte(0)) {
          throw ApiException.paymentOrderNotPayable(
            'Order total amount must be greater than 0.',
          );
        }

        // Step E: Call Mock Payment Gateway
        await this.auditService.logInTransaction(
          {
            userId,
            action: 'PAYMENT_STARTED',
            entityType: 'Order',
            entityId: String(order.id),
            success: true,
            metadata: {
              orderNumber: order.orderNumber,
              amount: order.totalAmount.toFixed(2),
              method: dto.method,
            },
          },
          tx,
        );

        const gatewayResult = await this.mockGateway.processPayment({
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: order.totalAmount,
          idempotencyKey,
        });

        if (gatewayResult.success) {
          // Success path: upsert payment, confirm order, record attempt
          const payment = await tx.payment.upsert({
            where: { orderId: order.id },
            create: {
              orderId: order.id,
              method: PaymentMethod.CARD, // map MOCK to enum or MOCK if enum has MOCK
              status: PaymentStatus.PAID,
              amount: order.totalAmount,
              provider: 'NEXACART_MOCK',
              transactionReference: gatewayResult.transactionReference,
              idempotencyKey,
              paidAt: now,
            },
            update: {
              method: PaymentMethod.MOCK,
              status: PaymentStatus.PAID,
              amount: order.totalAmount,
              provider: 'NEXACART_MOCK',
              transactionReference: gatewayResult.transactionReference,
              idempotencyKey,
              paidAt: now,
              failureReason: null,
            },
          });

          const updatedOrder = await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: PaymentStatus.PAID,
              status: OrderStatus.CONFIRMED,
            },
            include: { items: { orderBy: { id: 'asc' } } },
          });

          await tx.paymentAttempt.create({
            data: {
              orderId: order.id,
              paymentId: payment.id,
              status: PaymentAttemptStatus.SUCCEEDED,
              idempotencyKey,
              amount: order.totalAmount,
              transactionReference: gatewayResult.transactionReference,
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });

          await this.auditService.logInTransaction(
            {
              userId,
              action: 'PAYMENT_SUCCEEDED',
              entityType: 'Payment',
              entityId: String(payment.id),
              success: true,
              metadata: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                amount: order.totalAmount.toFixed(2),
                transactionReference: gatewayResult.transactionReference,
              },
            },
            tx,
          );

          return {
            replayed: false,
            payment: this.mapPaymentToResponse(payment, order.orderNumber),
            order: mapOrderToResponse({ ...updatedOrder, payment }),
          };
        } else {
          // Failure path
          await tx.order.update({
            where: { id: order.id },
            data: { paymentStatus: PaymentStatus.FAILED },
          });

          await tx.paymentAttempt.create({
            data: {
              orderId: order.id,
              status: PaymentAttemptStatus.FAILED,
              idempotencyKey,
              amount: order.totalAmount,
              failureReason:
                gatewayResult.failureReason ?? 'Mock payment failed',
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });

          await this.auditService.logInTransaction(
            {
              userId,
              action: 'PAYMENT_FAILED',
              entityType: 'Order',
              entityId: String(order.id),
              success: false,
              errorCode: 'PAYMENT_PROCESSING_FAILED',
              metadata: {
                orderNumber: order.orderNumber,
                reason: gatewayResult.failureReason,
              },
            },
            tx,
          );

          throw ApiException.paymentProcessingFailed(
            gatewayResult.failureReason,
          );
        }
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private mapPaymentToResponse(
    payment: {
      id: number;
      method: string;
      status: string;
      amount: { toFixed: (dp: number) => string };
      provider: string | null;
      transactionReference: string | null;
      paidAt: Date | null;
    },
    orderNumber: string,
  ): PaymentInfoResponse {
    return {
      id: payment.id,
      orderNumber,
      method: 'MOCK',
      status: payment.status,
      amount: payment.amount.toFixed(2),
      provider: payment.provider ?? 'NEXACART_MOCK',
      transactionReference: payment.transactionReference ?? '',
      paidAt: payment.paidAt,
    };
  }

  private extractPgCode(err: unknown): string | undefined {
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (typeof e['code'] === 'string') return e['code'];
      if (e['meta'] && typeof e['meta'] === 'object') {
        const meta = e['meta'] as Record<string, unknown>;
        if (typeof meta['code'] === 'string') return meta['code'];
      }
    }
    return undefined;
  }
}
