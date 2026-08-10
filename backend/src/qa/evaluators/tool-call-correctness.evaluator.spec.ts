import { Test, TestingModule } from '@nestjs/testing';
import { ToolCallCorrectnessEvaluator } from './tool-call-correctness.evaluator';
import { QaTemplateResolverService } from '../fixtures/qa-template-resolver.service';
import { AgentToolRegistryService } from '../../agent-tools/agent-tool-registry.service';
import { AgentToolCall, AgentToolCallStatus } from '../../generated/prisma/client';
import { ExpectedToolPlan } from './evaluator.types';

describe('ToolCallCorrectnessEvaluator (Component 1)', () => {
  let evaluator: ToolCallCorrectnessEvaluator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolCallCorrectnessEvaluator,
        QaTemplateResolverService,
        {
          provide: AgentToolRegistryService,
          useValue: {
            getTool: (name: string) => {
              const stateChangingTools = [
                'add_to_cart',
                'update_cart_item',
                'remove_cart_item',
                'reserve_cart_item',
                'checkout',
                'pay_order',
                'cancel_order',
                'refund_order',
              ];
              return {
                name,
                isStateChanging: stateChangingTools.includes(name),
              };
            },
          },
        },
      ],
    }).compile();

    evaluator = module.get<ToolCallCorrectnessEvaluator>(ToolCallCorrectnessEvaluator);
  });

  const mockFixtureContext = {
    customerId: 1,
    customerEmail: 'qa-test@nexacart.test',
    products: {
      targetProduct: {
        id: 100,
        sku: 'SKU-100',
        name: 'QA Wireless Headphones',
        price: '150.00',
        stockQuantity: 10,
        reservedQuantity: 0,
      },
    },
  };

  it('evaluates perfect tool sequence as 100%', () => {
    const actualCalls: AgentToolCall[] = [
      {
        id: 'c1',
        agentRunId: 'r1',
        sequenceNumber: 1,
        providerCallId: 'p1',
        toolName: 'search_products',
        arguments: { search: 'Headphones' },
        status: AgentToolCallStatus.SUCCEEDED,
        result: {},
        errorCode: null,
        errorMessage: null,
        durationMs: 50,
        requestId: null,
        qaRunId: null,
        createdAt: new Date(),
        completedAt: new Date(),
      },
      {
        id: 'c2',
        agentRunId: 'r1',
        sequenceNumber: 2,
        providerCallId: 'p2',
        toolName: 'get_cart',
        arguments: {},
        status: AgentToolCallStatus.SUCCEEDED,
        result: {},
        errorCode: null,
        errorMessage: null,
        durationMs: 40,
        requestId: null,
        qaRunId: null,
        createdAt: new Date(),
        completedAt: new Date(),
      },
      {
        id: 'c3',
        agentRunId: 'r1',
        sequenceNumber: 3,
        providerCallId: 'p3',
        toolName: 'add_to_cart',
        arguments: { productId: 100, quantity: 2 },
        status: AgentToolCallStatus.SUCCEEDED,
        result: {},
        errorCode: null,
        errorMessage: null,
        durationMs: 80,
        requestId: null,
        qaRunId: null,
        createdAt: new Date(),
        completedAt: new Date(),
      },
    ];

    const plan: ExpectedToolPlan = {
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
      maxStateChangingCalls: 1,
    };

    const res = evaluator.evaluate(actualCalls, plan, 80, mockFixtureContext);

    expect(res.overallScore).toBe(100);
    expect(res.passed).toBe(true);
    expect(res.missingSteps).toHaveLength(0);
    expect(res.argumentFailures).toHaveLength(0);
    expect(res.forbiddenCalls).toHaveLength(0);
  });

  it('lowers tool selection score when required step is missing', () => {
    const actualCalls: AgentToolCall[] = [
      {
        id: 'c1',
        agentRunId: 'r1',
        sequenceNumber: 1,
        providerCallId: 'p1',
        toolName: 'search_products',
        arguments: {},
        status: AgentToolCallStatus.SUCCEEDED,
        result: {},
        errorCode: null,
        errorMessage: null,
        durationMs: 50,
        requestId: null,
        qaRunId: null,
        createdAt: new Date(),
        completedAt: new Date(),
      },
    ];

    const plan: ExpectedToolPlan = {
      requiredSteps: [
        { tool: 'search_products' },
        { tool: 'get_cart' },
        { tool: 'add_to_cart' },
      ],
    };

    const res = evaluator.evaluate(actualCalls, plan, 80, mockFixtureContext);

    expect(res.toolSelectionScore).toBe(33.33);
    expect(res.missingSteps).toContain('get_cart');
    expect(res.missingSteps).toContain('add_to_cart');
    expect(res.passed).toBe(false);
  });

  it('lowers parameter score when argument fails assertion', () => {
    const actualCalls: AgentToolCall[] = [
      {
        id: 'c1',
        agentRunId: 'r1',
        sequenceNumber: 1,
        providerCallId: 'p1',
        toolName: 'add_to_cart',
        arguments: { productId: 100, quantity: 5 }, // expected 2
        status: AgentToolCallStatus.SUCCEEDED,
        result: {},
        errorCode: null,
        errorMessage: null,
        durationMs: 50,
        requestId: null,
        qaRunId: null,
        createdAt: new Date(),
        completedAt: new Date(),
      },
    ];

    const plan: ExpectedToolPlan = {
      requiredSteps: [
        {
          tool: 'add_to_cart',
          arguments: {
            quantity: { operator: 'EQUALS', value: 2 },
          },
        },
      ],
    };

    const res = evaluator.evaluate(actualCalls, plan, 80, mockFixtureContext);

    expect(res.parameterAccuracyScore).toBe(0);
    expect(res.argumentFailures).toHaveLength(1);
    expect(res.argumentFailures[0].argument).toBe('quantity');
  });

  it('penalizes forbidden tool calls', () => {
    const actualCalls: AgentToolCall[] = [
      {
        id: 'c1',
        agentRunId: 'r1',
        sequenceNumber: 1,
        providerCallId: 'p1',
        toolName: 'pay_order',
        arguments: {},
        status: AgentToolCallStatus.SUCCEEDED,
        result: {},
        errorCode: null,
        errorMessage: null,
        durationMs: 50,
        requestId: null,
        qaRunId: null,
        createdAt: new Date(),
        completedAt: new Date(),
      },
    ];

    const plan: ExpectedToolPlan = {
      requiredSteps: [],
      forbiddenTools: ['pay_order'],
    };

    const res = evaluator.evaluate(actualCalls, plan, 80, mockFixtureContext);

    expect(res.forbiddenCalls).toHaveLength(1);
    expect(res.safetyScore).toBe(70); // 100 - 30 penalty
  });
});
