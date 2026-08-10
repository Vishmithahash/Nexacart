import { Injectable } from '@nestjs/common';
import { OrdersService } from '../../orders/orders.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class ListOrdersTool implements AgentTool {
  readonly name = 'list_orders';
  readonly description =
    'List recent orders placed by the authenticated customer.';
  readonly isStateChanging = false;

  readonly parameters = {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description:
          'Number of recent orders to return (between 1 and 20, default 10).',
      },
    },
    required: ['limit'],
    additionalProperties: false,
  };

  constructor(private readonly ordersService: OrdersService) {}

  async execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const rawLimit =
        typeof args['limit'] === 'number' ? Math.floor(args['limit']) : 10;
      const limit = Math.max(1, Math.min(20, rawLimit));

      const result = await this.ordersService.listMyOrders(context.userId, {
        page: 1,
        limit,
      });

      return {
        ok: true,
        data: {
          orders: result.data,
          totalItems: result.pagination.totalItems,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'ORDER_LIST_FAILED',
          message: err.message ?? 'Failed to list orders',
          statusCode: err.status ?? 400,
        },
      };
    }
  }
}
