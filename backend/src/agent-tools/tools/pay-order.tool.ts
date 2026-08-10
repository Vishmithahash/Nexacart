import { Injectable } from '@nestjs/common';
import { PaymentsService } from '../../payments/payments.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class PayOrderTool implements AgentTool {
  readonly name = 'pay_order';
  readonly description =
    'Pay an existing pending NexaCart order belonging to the authenticated customer using the mock payment method. Requires orderNumber.';
  readonly isStateChanging = true;

  readonly parameters = {
    type: 'object',
    properties: {
      orderNumber: {
        type: 'string',
        description: 'Order number to pay (e.g. NXC-550E8400).',
      },
    },
    required: ['orderNumber'],
    additionalProperties: false,
  };

  constructor(private readonly paymentsService: PaymentsService) {}

  async execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const orderNumber =
        typeof args['orderNumber'] === 'string'
          ? args['orderNumber'].trim()
          : '';

      if (!orderNumber) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'orderNumber is required.',
            statusCode: 400,
          },
        };
      }

      const idempotencyKey =
        (context as any).derivedIdempotencyKey ??
        `agent-${context.agentRunId}-${Date.now()}`;

      const result = await this.paymentsService.payOrder(
        context.userId,
        orderNumber,
        { method: 'MOCK' },
        idempotencyKey,
      );

      return {
        ok: true,
        data: {
          replayed: result.replayed,
          payment: result.payment,
          orderStatus: result.order.status,
          paymentStatus: result.order.paymentStatus,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'PAYMENT_FAILED',
          message: err.message ?? 'Payment failed',
          statusCode: err.status ?? 400,
        },
      };
    }
  }
}
