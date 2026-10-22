import { Test, TestingModule } from '@nestjs/testing';
import { QaRunnerService } from './qa-runner.service';
import { PrismaService } from '../prisma/prisma.service';
import { QaScenariosService } from './scenarios/qa-scenarios.service';
import { QaFixtureService } from './fixtures/qa-fixture.service';
import { QaTemplateResolverService } from './fixtures/qa-template-resolver.service';
import { QaStateSnapshotService } from './state/qa-state-snapshot.service';
import { QaStateAssertionService } from './state/qa-state-assertion.service';
import { ToolCallCorrectnessEvaluator } from './evaluators/tool-call-correctness.evaluator';
import { StateConsistencyEvaluator } from './evaluators/state-consistency.evaluator';
import { AgentRunnerService } from '../agent/agent-runner.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { AgentToolRegistryService } from '../agent-tools/agent-tool-registry.service';
import { QaRunStatus, UserRole } from '../generated/prisma/client';
import { ApiException } from '../common/exceptions/api.exception';

describe('QaRunnerService', () => {
  let qaRunner: QaRunnerService;
  let prisma: any;
  let agentRunner: any;

  beforeEach(async () => {
    prisma = {
      qaRun: {
        create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'qa-run-123', ...args.data })),
        update: jest.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
        findUnique: jest.fn(),
      },
      qaStateSnapshot: {
        create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
      },
      qaEvaluationResult: {
        create: jest.fn().mockResolvedValue({ id: 'eval-1' }),
      },
    };

    agentRunner = {
      runAgent: jest.fn().mockResolvedValue({
        id: 'agent-run-999',
        provider: 'OPENAI',
        model: 'gpt-4o',
        systemPromptVersion: 'nexacart-customer-agent-v1',
        toolCalls: [
          { sequenceNumber: 1, toolName: 'search_products', arguments: {}, status: 'SUCCEEDED' },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaRunnerService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: QaScenariosService,
          useValue: {
            getScenarioByCode: jest.fn().mockResolvedValue({
              id: 'scen-1',
              code: 'QA-TC-001',
              name: 'Search product',
              version: 1,
              instructionTemplate: 'Find {{products.targetProduct.name}}',
              fixtureDefinition: {},
              expectedToolPlan: { requiredSteps: [{ tool: 'search_products' }] },
              expectedStateAssertions: [],
              toolPassThreshold: 80,
              statePassThreshold: 100,
            }),
          },
        },
        {
          provide: QaFixtureService,
          useValue: {
            prepareFixture: jest.fn().mockResolvedValue({
              customerId: 20,
              customerEmail: 'qa-test@nexacart.test',
              products: { targetProduct: { id: 100, name: 'QA Headphone' } },
            }),
          },
        },
        QaTemplateResolverService,
        {
          provide: QaStateSnapshotService,
          useValue: {
            captureSnapshot: jest.fn().mockResolvedValue({
              customer: { id: 20, email: 'qa-test@nexacart.test' },
              products: {},
              cart: { itemCount: 0, totalQuantity: 0, items: {} },
              orders: { count: 0 },
              payments: { count: 0, successfulTotal: '0.00' },
              refunds: { count: 0, successfulTotal: '0.00' },
              movements: { totalCount: 0, byType: { RESERVATION: 0, SALE: 0, CANCELLATION_RESTORE: 0 } },
            }),
          },
        },
        ToolCallCorrectnessEvaluator,
        StateConsistencyEvaluator,
        {
          provide: QaStateAssertionService,
          useValue: {
            evaluateAssertions: jest.fn().mockReturnValue({ score: 100, passed: true, details: [] }),
            evaluateInvariants: jest.fn().mockReturnValue({ score: 100, passed: true, details: [] }),
          },
        },
        { provide: AgentRunnerService, useValue: agentRunner },
        {
          provide: RequestContextService,
          useValue: {
            runWithOverrides: jest.fn().mockImplementation((_overrides, fn) => fn()),
          },
        },
        {
          provide: AgentToolRegistryService,
          useValue: {
            getTool: (name: string) => ({ name, isStateChanging: false }),
          },
        },
      ],
    }).compile();

    qaRunner = module.get<QaRunnerService>(QaRunnerService);
  });

  it('orchestrates a full successful QA run', async () => {
    const result = await qaRunner.runScenario('QA-TC-001');

    expect(result).toBeDefined();
    expect(prisma.qaRun.create).toHaveBeenCalled();
    expect(prisma.qaStateSnapshot.create).toHaveBeenCalledTimes(2); // BEFORE and AFTER
    expect(prisma.qaEvaluationResult.create).toHaveBeenCalledTimes(2); // Comp 1 and Comp 2
    expect(result.status).toBe(QaRunStatus.COMPLETED);
    expect(result.overallPassed).toBe(true);
  });

  it('captures AFTER snapshot and evaluates even if AgentRunner throws an exception', async () => {
    agentRunner.runAgent.mockRejectedValueOnce(new Error('OpenAI timeout'));

    const result = await qaRunner.runScenario('QA-TC-001');

    expect(result).toBeDefined();
    expect(prisma.qaStateSnapshot.create).toHaveBeenCalledTimes(2); // AFTER snapshot captured
    expect(result.status).toBe(QaRunStatus.COMPLETED);
    expect(result.errorMessage).toContain('OpenAI timeout');
  });

  it('links failed agent run and preserves executed tool evidence when error metadata is attached', async () => {
    const failedAgentRun = {
      id: 'failed-agent-run-777',
      provider: 'OLLAMA',
      model: 'qwen3.5:4b',
      systemPromptVersion: 'nexacart-customer-agent-v1',
      status: 'FAILED',
      toolCalls: [
        {
          sequenceNumber: 1,
          toolName: 'search_products',
          arguments: { q: 'headphones' },
          status: 'SUCCEEDED',
          result: { ok: true, data: { items: ['headphones'] } },
        },
      ],
    };

    const err = ApiException.llmProviderError('Ollama turn failed after tool execution');
    (err as any).agentRunId = failedAgentRun.id;
    (err as any).agentRun = failedAgentRun;

    agentRunner.runAgent.mockRejectedValueOnce(err);

    const result = await qaRunner.runScenario('QA-TC-001');

    expect(result).toBeDefined();
    // Verify QA run was linked to exact failed agent run
    expect(prisma.qaRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'qa-run-123' },
        data: expect.objectContaining({
          agentRunId: 'failed-agent-run-777',
          provider: 'OLLAMA',
          model: 'qwen3.5:4b',
          systemPromptVersion: 'nexacart-customer-agent-v1',
        }),
      }),
    );

    // Verify AFTER snapshot captured
    expect(prisma.qaStateSnapshot.create).toHaveBeenCalledTimes(2);

    // Component 1 evaluation received the executed tool call from failed agent run
    expect(prisma.qaEvaluationResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          component: 'TOOL_CALL_CORRECTNESS',
          passed: true,
        }),
      }),
    );
  });
});
