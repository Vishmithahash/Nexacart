import { Injectable } from '@nestjs/common';
import { CancellationsService } from '../../cancellations/cancellations.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class CancelOrderTool implements AgentTool {
  readonly name = 'cancel_order';
  readonly description =
    'Cancel an existing PENDING or CONFIRMED order belonging to the authenticated customer. Requires orderNumber and reason.';
  readonly isStateChanging = true;

  readonly parameters = {
    type: 'object',
    properties: {
      orderNumber: {
        type: 'string',
        description: 'Order number to cancel (e.g. NXC-550E8400).',
      },
      reason: {
        type: 'string',
        description: 'Reason for cancellation.',
      },
    },
    required: ['orderNumber', 'reason'],
    additionalProperties: false,
  };

  constructor(private readonly cancellationsService: CancellationsService) {}

  async execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const orderNumber =
        typeof args['orderNumber'] === 'string'
          ? args['orderNumber'].trim()
          : '';
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

      if (!reason) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'reason is required for cancellation.',
            statusCode: 400,
          },
        };
      }

      const idempotencyKey =
        (context as any).derivedIdempotencyKey ??
        `agent-${context.agentRunId}-${Date.now()}`;

      const result = await this.cancellationsService.cancelOrder(
        context.userId,
        orderNumber,
        { reason },
        idempotencyKey,
      );

      return {
        ok: true,
        data: {
          replayed: result.replayed,
          refundRequired: result.refundRequired,
          orderStatus: result.order.status,
          paymentStatus: result.order.paymentStatus,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'CANCELLATION_FAILED',
          message: err.message ?? 'Cancellation failed',
          statusCode: err.status ?? 400,
        },
      };
    }
  }
}
