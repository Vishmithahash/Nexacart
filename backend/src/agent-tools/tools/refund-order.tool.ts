import { Injectable } from '@nestjs/common';
import { RefundsService } from '../../refunds/refunds.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class RefundOrderTool implements AgentTool {
  readonly name = 'refund_order';
  readonly description =
    'Request a full or partial refund for a cancelled order that was previously paid. Requires orderNumber, amount (decimal string), and reason.';
  readonly isStateChanging = true;

  readonly parameters = {
    type: 'object',
    properties: {
      orderNumber: {
        type: 'string',
        description: 'Order number to refund (e.g. NXC-550E8400).',
      },
      amount: {
        type: 'string',
        description:
          'Amount to refund as a positive decimal string (e.g. "250.00").',
      },
      reason: {
        type: 'string',
        description: 'Reason for the refund request.',
      },
    },
    required: ['orderNumber', 'amount', 'reason'],
    additionalProperties: false,
  };

  constructor(private readonly refundsService: RefundsService) {}

  async execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const orderNumber =
        typeof args['orderNumber'] === 'string'
          ? args['orderNumber'].trim()
          : '';
      const amount =
        typeof args['amount'] === 'string' ? args['amount'].trim() : '';
      const reason =
        typeof args['reason'] === 'string' ? args['reason'].trim() : '';

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

      if (!amount) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'amount is required (decimal string e.g. "250.00").',
            statusCode: 400,
          },
        };
      }

      const idempotencyKey =
        (context as any).derivedIdempotencyKey ??
        `agent-${context.agentRunId}-${Date.now()}`;

      const result = await this.refundsService.createRefund(
        context.userId,
        orderNumber,
        { amount, reason },
        idempotencyKey,
      );

      return {
        ok: true,
        data: {
          replayed: result.replayed,
          refund: result.refund,
          payment: result.payment,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'REFUND_FAILED',
          message: err.message ?? 'Refund failed',
          statusCode: err.status ?? 400,
        },
      };
    }
  }
}
