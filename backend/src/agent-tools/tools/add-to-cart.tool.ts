import { Injectable } from '@nestjs/common';
import { CartService } from '../../cart/cart.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class AddToCartTool implements AgentTool {
  readonly name = 'add_to_cart';
  readonly description =
    'Add a product to the authenticated customer\'s active cart. Requires productId, quantity, and expectedCartVersion.';
  readonly isStateChanging = true;

  readonly parameters = {
    type: 'object',
    properties: {
      productId: {
        type: 'integer',
        description: 'Numeric ID of the product to add.',
      },
      quantity: {
        type: 'integer',
        description: 'Quantity of the product to add (must be at least 1).',
      },
      expectedCartVersion: {
        type: 'integer',
        description: 'Current expected cart version (obtained from get_cart).',
      },
    },
    required: ['productId', 'quantity', 'expectedCartVersion'],
    additionalProperties: false,
  };

  constructor(private readonly cartService: CartService) {}

  async execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const productId = Number(args['productId']);
      const quantity = Number(args['quantity']);
      const expectedCartVersion = Number(args['expectedCartVersion']);

      if (!Number.isInteger(productId) || productId <= 0) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'productId must be a positive integer.',
            statusCode: 400,
          },
        };
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'quantity must be a positive integer greater than 0.',
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

      const { body: cart, replayed } = await this.cartService.addItem(
        context.userId,
        { productId, quantity, expectedCartVersion },
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
          errorCode: errorObj.errorCode ?? 'CART_ADD_FAILED',
          message: errorObj.message ?? 'Failed to add item to cart',
          statusCode: errorObj.status ?? 400,
        },
      };
    }
  }
}
