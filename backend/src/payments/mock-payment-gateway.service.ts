import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/client';

export interface ProcessPaymentInput {
  orderId: number;
  orderNumber: string;
  amount: Decimal;
  idempotencyKey: string;
}

export interface ProcessPaymentResult {
  success: boolean;
  transactionReference: string;
  failureReason?: string;
}

/**
 * Mock Payment Gateway Abstraction.
 * In Phase 6, this service deterministically processes mock payments.
 * Designed so future QA/fault-injection framework can mock, wrap, or intercept
 * it to simulate timeouts, declined cards, gateway errors, or unexpected responses.
 */
@Injectable()
export class MockPaymentGatewayService {
  private readonly logger = new Logger(MockPaymentGatewayService.name);

  /**
   * Process a mock payment.
   * Returns a successful mock result with a unique transaction reference.
   */
  async processPayment(
    input: ProcessPaymentInput,
  ): Promise<ProcessPaymentResult> {
    this.logger.log(
      `Processing mock payment for orderId=${input.orderId} orderNumber=${input.orderNumber} amount=${input.amount.toFixed(2)}`,
    );

    const refHex = randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
    const transactionReference = `MOCK-PAY-${refHex}`;

    return Promise.resolve({
      success: true,
      transactionReference,
    });
  }
}
