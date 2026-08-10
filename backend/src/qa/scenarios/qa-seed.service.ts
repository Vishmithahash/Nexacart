import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const SEEDED_RESEARCH_SCENARIOS = [
  // 1. QA-TC-001 — Search product
  {
    code: 'QA-TC-001',
    name: 'Search available product',
    version: 1,
    description: 'Verifies read-only product search tool selection and preserves initial state.',
    instructionTemplate: 'Find the available {{products.targetProduct.name}}.',
    fixtureDefinition: {
      products: [
        {
          alias: 'targetProduct',
          name: 'QA Wireless Headphones',
          price: '12500.00',
          stockQuantity: 10,
          reservedQuantity: 0,
        },
      ],
    },
    expectedToolPlan: {
      requiredSteps: [
        {
          tool: 'search_products',
          arguments: {
            search: { operator: 'CONTAINS', value: 'Headphones' },
          },
        },
      ],
      allowedExtraReadTools: ['get_product', 'get_cart'],
      forbiddenTools: ['add_to_cart', 'checkout', 'pay_order', 'cancel_order', 'refund_order'],
      maxStateChangingCalls: 0,
    },
    expectedStateAssertions: [
      { path: 'products.targetProduct.stockQuantity', operator: 'UNCHANGED' },
      { path: 'products.targetProduct.reservedQuantity', operator: 'UNCHANGED' },
      { path: 'cart.totalQuantity', operator: 'AFTER_EQUALS', value: 0 },
    ],
    toolPassThreshold: '80.00',
    statePassThreshold: '100.00',
  },

  // 2. QA-TC-002 — Add product to cart
  {
    code: 'QA-TC-002',
    name: 'Add product to cart',
    version: 1,
    description: 'Verifies multi-step search -> get_cart -> add_to_cart workflow and inventory reservation.',
    instructionTemplate: 'Add two {{products.targetProduct.name}} to my cart.',
    fixtureDefinition: {
      products: [
        {
          alias: 'targetProduct',
          name: 'QA Wireless Headphones',
          price: '12500.00',
          stockQuantity: 10,
          reservedQuantity: 0,
        },
      ],
      cart: { create: true, items: [] },
    },
    expectedToolPlan: {
      requiredSteps: [
        { tool: 'search_products' },
        { tool: 'get_cart' },
        {
          tool: 'add_to_cart',
          arguments: {
            productId: { operator: 'EQUALS', valueTemplate: '{{products.targetProduct.id}}' },
            quantity: { operator: 'EQUALS', value: 2 },
          },
        },
      ],
      allowedExtraReadTools: ['get_product'],
      forbiddenTools: ['checkout', 'pay_order', 'cancel_order', 'refund_order'],
      maxStateChangingCalls: 1,
    },
    expectedStateAssertions: [
      { path: 'cart.totalQuantity', operator: 'AFTER_EQUALS', value: 2 },
      { path: 'products.targetProduct.stockQuantity', operator: 'UNCHANGED' },
      { path: 'products.targetProduct.reservedQuantity', operator: 'DELTA_EQUALS', value: 2 },
      { path: 'movements.byType.RESERVATION', operator: 'DELTA_EQUALS', value: 1 },
    ],
    toolPassThreshold: '80.00',
    statePassThreshold: '100.00',
  },

  // 3. QA-TC-003 — Invalid excessive quantity
  {
    code: 'QA-TC-003',
    name: 'Invalid excessive quantity request',
    version: 1,
    description: 'Verifies agent reaction when requesting quantity (5) exceeding available stock (2). State must remain unchanged.',
    instructionTemplate: 'Add five {{products.targetProduct.name}} to my cart.',
    fixtureDefinition: {
      products: [
        {
          alias: 'targetProduct',
          name: 'QA Limited Desk Lamp',
          price: '4500.00',
          stockQuantity: 2,
          reservedQuantity: 0,
        },
      ],
      cart: { create: true, items: [] },
    },
    expectedToolPlan: {
      requiredSteps: [
        { tool: 'search_products' },
        { tool: 'get_cart' },
        {
          tool: 'add_to_cart',
          arguments: {
            productId: { operator: 'EQUALS', valueTemplate: '{{products.targetProduct.id}}' },
            quantity: { operator: 'EQUALS', value: 5 },
          },
        },
      ],
      allowedExtraReadTools: ['get_product'],
      forbiddenTools: ['checkout', 'pay_order', 'cancel_order'],
      maxStateChangingCalls: 2,
    },
    expectedStateAssertions: [
      { path: 'cart.totalQuantity', operator: 'AFTER_EQUALS', value: 0 },
      { path: 'products.targetProduct.stockQuantity', operator: 'UNCHANGED' },
      { path: 'products.targetProduct.reservedQuantity', operator: 'UNCHANGED' },
    ],
    toolPassThreshold: '70.00',
    statePassThreshold: '100.00',
  },

  // 4. QA-TC-004 — Checkout prepared cart
  {
    code: 'QA-TC-004',
    name: 'Checkout prepared cart',
    version: 1,
    description: 'Verifies cart checkout converting active cart into PENDING order and consuming reserved stock.',
    instructionTemplate: 'Checkout my cart using my shipping address.',
    fixtureDefinition: {
      customer: { withShippingAddress: true },
      products: [
        {
          alias: 'targetProduct',
          name: 'QA Smart Watch',
          price: '25000.00',
          stockQuantity: 10,
          reservedQuantity: 0,
        },
      ],
      cart: {
        create: true,
        items: [
          { productAlias: 'targetProduct', quantity: 1, withReservation: true },
        ],
      },
    },
    expectedToolPlan: {
      requiredSteps: [
        { tool: 'get_cart' },
        { tool: 'list_shipping_addresses' },
        {
          tool: 'checkout',
          arguments: {
            shippingAddressId: { operator: 'EQUALS', valueTemplate: '{{shippingAddressId}}' },
          },
        },
      ],
      allowedExtraReadTools: ['get_product', 'list_orders'],
      forbiddenTools: ['pay_order', 'cancel_order', 'refund_order'],
      maxStateChangingCalls: 1,
    },
    expectedStateAssertions: [
      { path: 'orders.count', operator: 'DELTA_EQUALS', value: 1 },
      { path: 'orders.latest.status', operator: 'AFTER_EQUALS', value: 'PENDING' },
      { path: 'products.targetProduct.stockQuantity', operator: 'DELTA_EQUALS', value: -1 },
      { path: 'products.targetProduct.reservedQuantity', operator: 'DELTA_EQUALS', value: -1 },
      { path: 'movements.byType.SALE', operator: 'DELTA_EQUALS', value: 1 },
    ],
    toolPassThreshold: '80.00',
    statePassThreshold: '100.00',
  },

  // 5. QA-TC-005 — Pay pending order
  {
    code: 'QA-TC-005',
    name: 'Pay pending order',
    version: 1,
    description: 'Verifies paying an existing pending order, updating order status to CONFIRMED and paymentStatus to PAID.',
    instructionTemplate: 'Pay my pending order {{orderNumber}}.',
    fixtureDefinition: {
      customer: { withShippingAddress: true },
      products: [
        {
          alias: 'targetProduct',
          name: 'QA Mechanical Keyboard',
          price: '18500.00',
          stockQuantity: 5,
          reservedQuantity: 0,
        },
      ],
      order: {
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        totalAmount: '18500.00',
        isPaid: false,
      },
    },
    expectedToolPlan: {
      requiredSteps: [
        { tool: 'list_orders' },
        {
          tool: 'pay_order',
          arguments: {
            orderNumber: { operator: 'EQUALS', valueTemplate: '{{orderNumber}}' },
          },
        },
      ],
      allowedExtraReadTools: ['get_order'],
      forbiddenTools: ['cancel_order', 'refund_order'],
      maxStateChangingCalls: 1,
    },
    expectedStateAssertions: [
      { path: 'orders.latest.status', operator: 'AFTER_EQUALS', value: 'CONFIRMED' },
      { path: 'orders.latest.paymentStatus', operator: 'AFTER_EQUALS', value: 'PAID' },
      { path: 'payments.count', operator: 'DELTA_EQUALS', value: 1 },
    ],
    toolPassThreshold: '80.00',
    statePassThreshold: '100.00',
  },
];

@Injectable()
export class QaSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QaSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.seedScenarios();
  }

  /**
   * Idempotently seed curated research QA scenarios into database.
   */
  async seedScenarios() {
    for (const scenario of SEEDED_RESEARCH_SCENARIOS) {
      await this.prisma.qaScenario.upsert({
        where: { code: scenario.code },
        update: {
          name: scenario.name,
          version: scenario.version,
          description: scenario.description,
          instructionTemplate: scenario.instructionTemplate,
          fixtureDefinition: scenario.fixtureDefinition as any,
          expectedToolPlan: scenario.expectedToolPlan as any,
          expectedStateAssertions: scenario.expectedStateAssertions as any,
          toolPassThreshold: scenario.toolPassThreshold as any,
          statePassThreshold: scenario.statePassThreshold as any,
          isActive: true,
        },
        create: {
          code: scenario.code,
          name: scenario.name,
          version: scenario.version,
          description: scenario.description,
          instructionTemplate: scenario.instructionTemplate,
          fixtureDefinition: scenario.fixtureDefinition as any,
          expectedToolPlan: scenario.expectedToolPlan as any,
          expectedStateAssertions: scenario.expectedStateAssertions as any,
          toolPassThreshold: scenario.toolPassThreshold as any,
          statePassThreshold: scenario.statePassThreshold as any,
          isActive: true,
        },
      });
    }
    this.logger.log(`Seeded ${SEEDED_RESEARCH_SCENARIOS.length} research QA scenarios.`);
  }
}
