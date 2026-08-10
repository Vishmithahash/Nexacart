import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AddressesModule } from '../addresses/addresses.module';
import { CartModule } from '../cart/cart.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { CancellationsModule } from '../cancellations/cancellations.module';
import { RefundsModule } from '../refunds/refunds.module';

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

import { AgentToolRegistryService } from './agent-tool-registry.service';
import { AgentToolExecutorService } from './agent-tool-executor.service';

const TOOL_PROVIDERS = [
  SearchProductsTool,
  GetProductTool,
  ListShippingAddressesTool,
  GetCartTool,
  AddToCartTool,
  UpdateCartItemTool,
  RemoveCartItemTool,
  ReserveCartItemTool,
  CheckoutTool,
  ListOrdersTool,
  GetOrderTool,
  PayOrderTool,
  CancelOrderTool,
  RefundOrderTool,
];

@Module({
  imports: [
    CatalogModule,
    AddressesModule,
    CartModule,
    ReservationsModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
    CancellationsModule,
    RefundsModule,
  ],
  providers: [
    ...TOOL_PROVIDERS,
    AgentToolRegistryService,
    AgentToolExecutorService,
  ],
  exports: [
    AgentToolRegistryService,
    AgentToolExecutorService,
    ...TOOL_PROVIDERS,
  ],
})
export class AgentToolsModule {}
