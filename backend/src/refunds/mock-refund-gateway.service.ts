import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/client';

export interface ProcessRefundInput {
  orderId: number;
  orderNumber: string;
  paymentId: number;
  amount: Decimal;
  idempotencyKey: string;
  reason?: string;
}

export interface ProcessRefundResult {
  success: boolean;
  transactionReference: string;
  failureReason?: string;
}

/**
 * Mock Refund Gateway Abstraction.
 * In Phase 6, this service deterministically processes mock refunds.
 * Designed so future QA/fault-injection framework can mock, wrap, or intercept
 * it to simulate timeouts, refund failures, or network issues.
 */
@Injectable()
export class MockRefundGatewayService {
  private readonly logger = new Logger(MockRefundGatewayService.name);

  async processRefund(input: ProcessRefundInput): Promise<ProcessRefundResult> {
    this.logger.log(
      `Processing mock refund for orderId=${input.orderId} orderNumber=${input.orderNumber} paymentId=${input.paymentId} amount=${input.amount.toFixed(2)}`,
    );

    const refHex = randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
    const transactionReference = `MOCK-REF-${refHex}`;

    return Promise.resolve({
      success: true,
      transactionReference,
    });
  }
}
