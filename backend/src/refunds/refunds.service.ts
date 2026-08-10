import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ClockService } from '../common/clock/clock.service';
import { ApiException } from '../common/exceptions/api.exception';
import {
  OrderStatus,
  PaymentStatus,
  RefundStatus,
} from '../generated/prisma/client';
import { MockRefundGatewayService } from './mock-refund-gateway.service';
import { CreateRefundDto } from './dto/create-refund.dto';

export interface RefundInfoResponse {
  id: string;
  orderNumber: string;
  amount: string;
  status: string;
  reason: string | null;
  transactionReference: string;
  createdAt: Date;
}

export interface RefundPaymentSummaryResponse {
  status: string;
  paidAmount: string;
  refundedAmount: string;
  remainingRefundableAmount: string;
}

export interface CreateRefundResult {
  replayed: boolean;
  refund: RefundInfoResponse;
  payment: RefundPaymentSummaryResponse;
}

const MAX_RETRIES = 3;
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';
const PRISMA_SERIALIZATION_CODE = 'P2034';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mockGateway: MockRefundGatewayService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly clockService: ClockService,
  ) {}

  async createRefund(
    userId: number,
    orderNumber: string,
    dto: CreateRefundDto,
    rawIdempotencyKey: string | undefined,
  ): Promise<CreateRefundResult> {
    // 1. Validate idempotency key
    if (!rawIdempotencyKey) {
      throw ApiException.paymentIdempotencyKeyRequired();
    }
    const idempotencyKey = rawIdempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      throw ApiException.paymentIdempotencyKeyRequired();
    }

    // 2. Validate amount string
    let requestedAmount: Decimal;
    try {
      requestedAmount = new Decimal(dto.amount.trim());
      if (requestedAmount.lte(0)) {
        throw new Error('Must be positive');
      }
    } catch {
      throw ApiException.refundAmountInvalid(
        'Refund amount must be a positive decimal string (e.g. "250.00").',
      );
    }

    const normalizedReason = dto.reason?.trim();

    // 3. Initial lookup
    const existingOrder = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: { payment: true, refunds: true },
    });

    if (!existingOrder || existingOrder.userId !== userId) {
      throw ApiException.orderNotFound();
    }

    // 4. Retry loop for serializable transactions
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.executeRefundTransaction(
          userId,
          existingOrder.id,
          requestedAmount,
          normalizedReason,
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
            `Refund serialization conflict (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`,
          );
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  private async executeRefundTransaction(
    userId: number,
    orderId: number,
    requestedAmount: Decimal,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<CreateRefundResult> {
    const ctx = this.requestContext.get();

    return this.prisma.$transaction(
      async (tx) => {
        // Step A: Load order with payment and refunds
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            payment: true,
            refunds: {
              orderBy: { createdAt: 'desc' },
            },
          },
        });

        if (!order || order.userId !== userId) {
          throw ApiException.orderNotFound();
        }

        // Step B: Check idempotency replay for this order and key
        const existingRefundWithKey = order.refunds.find(
          (r) => r.idempotencyKey === idempotencyKey,
        );

        if (existingRefundWithKey) {
          if (existingRefundWithKey.status === RefundStatus.SUCCEEDED) {
            // Check request parameters matching (amount must match)
            if (!existingRefundWithKey.amount.equals(requestedAmount)) {
              throw ApiException.refundIdempotencyConflict();
            }

            const payment = order.payment!;
            const totalSucceededRefunds = order.refunds
              .filter((r) => r.status === RefundStatus.SUCCEEDED)
              .reduce((sum, r) => sum.add(r.amount), new Decimal(0));

            const remaining = payment.amount.sub(totalSucceededRefunds);

            await this.auditService.logInTransaction(
              {
                userId,
                action: 'REFUND_REPLAYED',
                entityType: 'Refund',
                entityId: existingRefundWithKey.id,
                success: true,
                metadata: {
                  orderId: order.id,
                  orderNumber: order.orderNumber,
                  refundId: existingRefundWithKey.id,
                  idempotencyKey,
                  replayed: true,
                },
              },
              tx,
            );

            return {
              replayed: true,
              refund: this.mapRefundToResponse(
                existingRefundWithKey,
                order.orderNumber,
              ),
              payment: {
                status: payment.status,
                paidAmount: payment.amount.toFixed(2),
                refundedAmount: totalSucceededRefunds.toFixed(2),
                remainingRefundableAmount: remaining.toFixed(2),
              },
            };
          } else {
            throw ApiException.refundProcessingFailed(
              existingRefundWithKey.failureReason ??
                'Previous refund attempt with this key failed.',
            );
          }
        }

        // Step C: Validate order status — MUST be CANCELLED
        if (order.status !== OrderStatus.CANCELLED) {
          throw ApiException.refundOrderNotCancelled();
        }

        // Step D: Validate payment
        const payment = order.payment;
        if (!payment) {
          throw ApiException.refundPaymentNotFound();
        }

        if (payment.status === PaymentStatus.REFUNDED) {
          throw ApiException.refundAlreadyComplete();
        }

        if (
          payment.status !== PaymentStatus.PAID &&
          payment.status !== PaymentStatus.PARTIALLY_REFUNDED
        ) {
          throw ApiException.refundNotAllowed(
            `Payment is in ${payment.status} state, expected PAID or PARTIALLY_REFUNDED.`,
          );
        }

        // Step E: Calculate existing succeeded refunds
        const currentSucceededRefunds = order.refunds
          .filter((r) => r.status === RefundStatus.SUCCEEDED)
          .reduce((sum, r) => sum.add(r.amount), new Decimal(0));

        const remainingRefundable = payment.amount.sub(currentSucceededRefunds);

        if (requestedAmount.gt(remainingRefundable)) {
          throw ApiException.refundAmountExceedsPayment(
            `Requested refund of ${requestedAmount.toFixed(2)} exceeds remaining refundable balance of ${remainingRefundable.toFixed(2)}.`,
          );
        }

        // Step F: Call Mock Refund Gateway
        await this.auditService.logInTransaction(
          {
            userId,
            action: 'REFUND_STARTED',
            entityType: 'Payment',
            entityId: String(payment.id),
            success: true,
            metadata: {
              orderNumber: order.orderNumber,
              amount: requestedAmount.toFixed(2),
              paymentId: payment.id,
            },
          },
          tx,
        );

        const gatewayResult = await this.mockGateway.processRefund({
          orderId: order.id,
          orderNumber: order.orderNumber,
          paymentId: payment.id,
          amount: requestedAmount,
          idempotencyKey,
          reason,
        });

        if (gatewayResult.success) {
          // Success path: create Refund, update Payment status, log audit
          const refund = await tx.refund.create({
            data: {
              orderId: order.id,
              paymentId: payment.id,
              amount: requestedAmount,
              status: RefundStatus.SUCCEEDED,
              idempotencyKey,
              reason: reason ?? null,
              transactionReference: gatewayResult.transactionReference,
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });

          const newTotalRefunded = currentSucceededRefunds.add(requestedAmount);
          const newPaymentStatus = newTotalRefunded.equals(payment.amount)
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED;

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: { status: newPaymentStatus },
          });

          await tx.order.update({
            where: { id: order.id },
            data: { paymentStatus: newPaymentStatus },
          });

          const newRemaining = payment.amount.sub(newTotalRefunded);

          await this.auditService.logInTransaction(
            {
              userId,
              action: 'REFUND_SUCCEEDED',
              entityType: 'Refund',
              entityId: refund.id,
              success: true,
              metadata: {
                orderId: order.id,
                orderNumber: order.orderNumber,
                paymentId: payment.id,
                amount: requestedAmount.toFixed(2),
                transactionReference: gatewayResult.transactionReference,
                newPaymentStatus,
              },
            },
            tx,
          );

          return {
            replayed: false,
            refund: this.mapRefundToResponse(refund, order.orderNumber),
            payment: {
              status: updatedPayment.status,
              paidAmount: payment.amount.toFixed(2),
              refundedAmount: newTotalRefunded.toFixed(2),
              remainingRefundableAmount: newRemaining.toFixed(2),
            },
          };
        } else {
          // Failure path
          const failedRefund = await tx.refund.create({
            data: {
              orderId: order.id,
              paymentId: payment.id,
              amount: requestedAmount,
              status: RefundStatus.FAILED,
              idempotencyKey,
              reason: reason ?? null,
              failureReason:
                gatewayResult.failureReason ?? 'Mock refund failed',
              requestId: ctx?.requestId ?? null,
              qaRunId: ctx?.qaRunId ?? null,
              toolCallId: ctx?.toolCallId ?? null,
            },
          });

          await this.auditService.logInTransaction(
            {
              userId,
              action: 'REFUND_FAILED',
              entityType: 'Refund',
              entityId: failedRefund.id,
              success: false,
              errorCode: 'REFUND_PROCESSING_FAILED',
              metadata: {
                orderNumber: order.orderNumber,
                reason: gatewayResult.failureReason,
              },
            },
            tx,
          );

          throw ApiException.refundProcessingFailed(
            gatewayResult.failureReason,
          );
        }
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private mapRefundToResponse(
    refund: {
      id: string;
      amount: Decimal;
      status: string;
      reason: string | null;
      transactionReference: string | null;
      createdAt: Date;
    },
    orderNumber: string,
  ): RefundInfoResponse {
    return {
      id: refund.id,
      orderNumber,
      amount: refund.amount.toFixed(2),
      status: refund.status,
      reason: refund.reason,
      transactionReference: refund.transactionReference ?? '',
      createdAt: refund.createdAt,
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
