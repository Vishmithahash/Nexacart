import { Injectable } from '@nestjs/common';
import { CartService } from '../../cart/cart.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class GetCartTool implements AgentTool {
  readonly name = 'get_cart';
  readonly description =
    'Get the authenticated customer\'s current active shopping cart, items, quantities, reservations, subtotal, and cart version.';
  readonly isStateChanging = false;

  readonly parameters = {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  };

  constructor(private readonly cartService: CartService) {}

  async execute(
    _args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const cart = await this.cartService.getActiveCart(context.userId);

      return {
        ok: true,
        data: {
          id: cart.id,
          version: cart.version,
          status: cart.status,
          subtotal: cart.summary.subtotal,
          totalQuantity: cart.summary.totalQuantity,
          items: cart.items.map((i) => ({
            id: i.id,
            productId: i.productId,
            name: i.name,
            sku: i.sku,
            unitPrice: i.priceAtReservation,
            currentPrice: i.currentPrice,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
            reservation: i.reservation
              ? {
                  id: i.reservation.id,
                  quantity: i.reservation.quantity,
                  status: i.reservation.status,
                  expiresAt: i.reservation.expiresAt,
                  isExpired:
                    i.reservation.expiresAt !== null
                      ? i.reservation.expiresAt <= new Date()
                      : false,
                }
              : null,
          })),
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
          errorCode: errorObj.errorCode ?? 'CART_NOT_FOUND',
          message: errorObj.message ?? 'Active cart not found',
          statusCode: errorObj.status ?? 404,
        },
      };
    }
  }
}
