import { Injectable } from '@nestjs/common';
import { OrdersService } from '../../orders/orders.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class GetOrderTool implements AgentTool {
  readonly name = 'get_order';
  readonly description =
    'Get detailed order information by order number (e.g. NXC-550E8400). Customer own orders only.';
  readonly isStateChanging = false;

  readonly parameters = {
    type: 'object',
    properties: {
      orderNumber: {
        type: 'string',
        description: 'Order number to retrieve.',
      },
    },
    required: ['orderNumber'],
    additionalProperties: false,
  };

  constructor(private readonly ordersService: OrdersService) {}

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

      const order = await this.ordersService.getMyOrderByOrderNumber(
        context.userId,
        orderNumber,
      );

      return {
        ok: true,
        data: order,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'ORDER_NOT_FOUND',
          message: err.message ?? 'Order not found',
          statusCode: err.status ?? 404,
        },
      };
    }
  }
}
