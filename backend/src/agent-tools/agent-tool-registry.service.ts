import { Injectable, Logger } from '@nestjs/common';
import { AgentTool } from './agent-tool.interface';
import { SearchProductsTool } from './tools/search-products.tool';
import { GetProductTool } from './tools/get-product.tool';
import { ListShippingAddressesTool } from './tools/list-shipping-addresses.tool';
import { GetCartTool } from './tools/get-cart.tool';
import { AddToCartTool } from './tools/add-to-cart.tool';
import { UpdateCartItemTool } from './tools/update-cart-item.tool';
import { RemoveCartItemTool } from './tools/remove-cart-item.tool';
import { ReserveCartItemTool } from './tools/reserve-cart-item.tool';
import { CheckoutTool } from './tools/checkout.tool';
import { ListOrdersTool } from './tools/list-orders.tool';
import { GetOrderTool } from './tools/get-order.tool';
import { PayOrderTool } from './tools/pay-order.tool';
import { CancelOrderTool } from './tools/cancel-order.tool';
import { RefundOrderTool } from './tools/refund-order.tool';

/**
 * Controlled Tool Registry Service.
 * Maintains an explicit allowlist of tools permitted for LLM agent interaction.
 * SECURITY: Prevents arbitrary tool invocation or dynamic controller exposure.
 */
@Injectable()
export class AgentToolRegistryService {
  private readonly logger = new Logger(AgentToolRegistryService.name);
  private readonly registry = new Map<string, AgentTool>();

  constructor(
    searchProductsTool: SearchProductsTool,
    getProductTool: GetProductTool,
    listShippingAddressesTool: ListShippingAddressesTool,
    getCartTool: GetCartTool,
    addToCartTool: AddToCartTool,
    updateCartItemTool: UpdateCartItemTool,
    removeCartItemTool: RemoveCartItemTool,
    reserveCartItemTool: ReserveCartItemTool,
    checkoutTool: CheckoutTool,
    listOrdersTool: ListOrdersTool,
    getOrderTool: GetOrderTool,
    payOrderTool: PayOrderTool,
    cancelOrderTool: CancelOrderTool,
    refundOrderTool: RefundOrderTool,
  ) {
    const customerTools: AgentTool[] = [
      searchProductsTool,
      getProductTool,
      listShippingAddressesTool,
      getCartTool,
      addToCartTool,
      updateCartItemTool,
      removeCartItemTool,
      reserveCartItemTool,
      checkoutTool,
      listOrdersTool,
      getOrderTool,
      payOrderTool,
      cancelOrderTool,
      refundOrderTool,
    ];

    for (const tool of customerTools) {
      this.registry.set(tool.name, tool);
    }
  }

  getTool(toolName: string): AgentTool | undefined {
    return this.registry.get(toolName);
  }

  getAllTools(): AgentTool[] {
    return Array.from(this.registry.values());
  }

  getToolDefinitions() {
    return this.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
}
