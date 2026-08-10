import { Injectable } from '@nestjs/common';
import { CartService } from '../../cart/cart.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class RemoveCartItemTool implements AgentTool {
  readonly name = 'remove_cart_item';
  readonly description =
    'Remove an item from the active cart. Requires itemId and expectedCartVersion.';
  readonly isStateChanging = true;

  readonly parameters = {
    type: 'object',
    properties: {
      itemId: {
        type: 'integer',
        description: 'Numeric ID of the cart item to remove.',
      },
      expectedCartVersion: {
        type: 'integer',
        description: 'Current expected cart version.',
      },
    },
    required: ['itemId', 'expectedCartVersion'],
    additionalProperties: false,
  };

  constructor(private readonly cartService: CartService) {}

  async execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const itemId = Number(args['itemId']);
      const expectedCartVersion = Number(args['expectedCartVersion']);

      if (!Number.isInteger(itemId) || itemId <= 0) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'itemId must be a positive integer.',
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
        (context as { derivedIdempotencyKey?: string }).derivedIdempotencyKey ??
        `agent-${context.agentRunId}-${Date.now()}`;

      const { body: cart, replayed } = await this.cartService.removeItem(
        context.userId,
        itemId,
        expectedCartVersion,
        idempotencyKey,
      );

      return {
        ok: true,
        data: {
          cartId: cart.id,
          newVersion: cart.version,
          totalQuantity: cart.summary.totalQuantity,
          subtotal: cart.summary.subtotal,
          replayed,
        },
      };
    } catch (err: unknown) {
      const errorObj = err as {
        errorCode?: string;
        message?: string;
        status?: number;
      };
      return {
        ok: false,
        error: {
          errorCode: errorObj.errorCode ?? 'CART_REMOVE_FAILED',
          message: errorObj.message ?? 'Failed to remove cart item',
          statusCode: errorObj.status ?? 400,
        },
      };
    }
  }
}
