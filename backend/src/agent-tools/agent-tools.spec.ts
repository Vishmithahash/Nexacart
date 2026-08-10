import { Test } from '@nestjs/testing';
import { AgentToolRegistryService } from './agent-tool-registry.service';
import { AgentToolExecutorService } from './agent-tool-executor.service';
import { RequestContextService } from '../common/request-context/request-context.service';
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
import { CatalogService } from '../catalog/catalog.service';
import { AddressesService } from '../addresses/addresses.service';
import { CartService } from '../cart/cart.service';
import { ReservationsService } from '../reservations/reservations.service';
import { CheckoutService } from '../checkout/checkout.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { CancellationsService } from '../cancellations/cancellations.service';
import { RefundsService } from '../refunds/refunds.service';
import { UserRole } from '../generated/prisma/client';

describe('Agent Tool Registry & Executor', () => {
  let registry: AgentToolRegistryService;
  let executor: AgentToolExecutorService;
  let catalogService: jest.Mocked<CatalogService>;

  beforeEach(async () => {
    catalogService = {
      listActiveProducts: jest.fn(),
      getActiveProductById: jest.fn(),
    } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentToolRegistryService,
        AgentToolExecutorService,
        RequestContextService,
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
        { provide: CatalogService, useValue: catalogService },
        { provide: AddressesService, useValue: {} },
        { provide: CartService, useValue: {} },
        { provide: ReservationsService, useValue: {} },
        { provide: CheckoutService, useValue: {} },
        { provide: OrdersService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: CancellationsService, useValue: {} },
        { provide: RefundsService, useValue: {} },
      ],
    }).compile();

    registry = moduleRef.get(AgentToolRegistryService);
    executor = moduleRef.get(AgentToolExecutorService);
  });

  describe('Tool Allowlist', () => {
    it('exposes exactly 14 customer tools in registry', () => {
      const tools = registry.getAllTools();
      expect(tools.length).toBe(14);
    });

    it('rejects unregistered tools like execute_sql or admin tools', async () => {
      const result = await executor.executeTool(
        {
          agentToolCallId: '550e8400-e29b-41d4-a716-446655440000',
          toolName: 'execute_sql',
          arguments: { query: 'DROP TABLE users;' },
          sequenceNumber: 1,
        },
        { userId: 1, role: UserRole.CUSTOMER, agentRunId: 'run-1' },
      );

      expect(result.status).toBe('INVALID_ARGUMENTS');
      expect(result.errorCode).toBe('AGENT_TOOL_NOT_FOUND');
      expect(result.result.ok).toBe(false);
    });
  });

  describe('Runtime Validation & Execution', () => {
    it('executes search_products tool when arguments are valid', async () => {
      catalogService.listActiveProducts.mockResolvedValueOnce({
        data: [
          {
            id: 10,
            sku: 'SKU-10',
            name: 'Wireless Headphones',
            slug: 'wireless-headphones',
            description: 'Desc',
            price: '150.00',
            currencyCode: 'USD',
            imageUrls: [],
            availableQuantity: 5,
            stockStatus: 'IN_STOCK',
            category: { id: 1, name: 'Electronics', slug: 'electronics' },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        pagination: {
          totalItems: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        filters: {
          search: 'Headphones',
          category: null,
          minPrice: null,
          maxPrice: null,
          inStock: true,
          sort: 'newest',
        },
      } as any);

      const result = await executor.executeTool(
        {
          agentToolCallId: '550e8400-e29b-41d4-a716-446655440001',
          toolName: 'search_products',
          arguments: {
            search: 'Headphones',
            category: null,
            inStock: true,
            limit: 5,
          },
          sequenceNumber: 1,
        },
        { userId: 1, role: UserRole.CUSTOMER, agentRunId: 'run-1' },
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.result.ok).toBe(true);
      expect((result.result.data as any).products.length).toBe(1);
    });

    it('rejects invalid argument types for get_product', async () => {
      const result = await executor.executeTool(
        {
          agentToolCallId: '550e8400-e29b-41d4-a716-446655440002',
          toolName: 'get_product',
          arguments: { productId: -5 },
          sequenceNumber: 1,
        },
        { userId: 1, role: UserRole.CUSTOMER, agentRunId: 'run-1' },
      );

      expect(result.status).toBe('INVALID_ARGUMENTS');
      expect(result.result.ok).toBe(false);
    });
  });
});
