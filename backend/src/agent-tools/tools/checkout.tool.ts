import { Injectable } from '@nestjs/common';
import { CheckoutService } from '../../checkout/checkout.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class CheckoutTool implements AgentTool {
  readonly name = 'checkout';
  readonly description =
    'Convert active cart into a PENDING order. Requires shippingAddressId and expectedCartVersion.';
  readonly isStateChanging = true;

  readonly parameters = {
    type: 'object',
    properties: {
      shippingAddressId: {
        type: 'integer',
        description: "Numeric ID of the customer's shipping address.",
      },
      expectedCartVersion: {
        type: 'integer',
        description: 'Current expected cart version.',
      },
    },
    required: ['shippingAddressId', 'expectedCartVersion'],
    additionalProperties: false,
  };

  constructor(private readonly checkoutService: CheckoutService) {}

  async execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const shippingAddressId = Number(args['shippingAddressId']);
      const expectedCartVersion = Number(args['expectedCartVersion']);

      if (!Number.isInteger(shippingAddressId) || shippingAddressId <= 0) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'shippingAddressId must be a positive integer.',
            statusCode: 400,
          },
        };
      }

      if (!Number.isInteger(expectedCartVersion) || expectedCartVersion < 0) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'expectedCartVersion must be a non-negative integer.',
            statusCode: 400,
          },
        };
      }

      const idempotencyKey =
        (context as any).derivedIdempotencyKey ??
        `agent-${context.agentRunId}-${Date.now()}`;

      const result = await this.checkoutService.checkout(
        context.userId,
        { shippingAddressId, expectedCartVersion },
        idempotencyKey,
      );

      return {
        ok: true,
        data: {
          replayed: result.replayed,
          order: result.order,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'CHECKOUT_FAILED',
          message: err.message ?? 'Checkout failed',
          statusCode: err.status ?? 400,
        },
      };
    }
  }
}
