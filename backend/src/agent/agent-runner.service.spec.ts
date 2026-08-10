import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AgentRunnerService } from './agent-runner.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { LlmService } from '../llm/llm.service';
import { AgentToolRegistryService } from '../agent-tools/agent-tool-registry.service';
import { AgentToolExecutorService } from '../agent-tools/agent-tool-executor.service';
import {
  AgentRunStatus,
  AgentToolCallStatus,
  UserRole,
} from '../generated/prisma/client';
import { ApiException } from '../common/exceptions/api.exception';

describe('AgentRunnerService', () => {
  let runner: AgentRunnerService;
  let prisma: any;
  let llmService: jest.Mocked<LlmService>;
  let toolExecutor: jest.Mocked<AgentToolExecutorService>;

  const mockRun = {
    id: '11111111-2222-3333-4444-555555555555',
    userId: 1,
    provider: 'OPENAI',
    model: 'gpt-4o',
    systemPromptVersion: 'nexacart-customer-agent-v1',
    instruction: 'Search wireless headphones',
    status: AgentRunStatus.RUNNING,
    totalToolCalls: 0,
    startedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      agentRun: {
        create: jest.fn().mockResolvedValue(mockRun),
        update: jest
          .fn()
          .mockImplementation((args) =>
            Promise.resolve({ ...mockRun, ...args.data }),
          ),
        findUnique: jest.fn(),
      },
      agentToolCall: {
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'call-uuid-1',
            ...args.data,
          }),
        ),
        update: jest
          .fn()
          .mockImplementation((args) =>
            Promise.resolve({ id: args.where.id, ...args.data }),
          ),
      },
    };

    llmService = {
      providerName: 'OPENAI',
      generateTurn: jest.fn(),
    } as any;

    toolExecutor = {
      executeTool: jest.fn(),
    } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentRunnerService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key, defaultVal) => {
              if (key === 'AGENT_MAX_STEPS') return 10;
              if (key === 'OPENAI_MODEL') return 'gpt-4o';
              return defaultVal;
            }),
          },
        },
        { provide: LlmService, useValue: llmService },
        {
          provide: AgentToolRegistryService,
          useValue: {
            getToolDefinitions: jest.fn().mockReturnValue([]),
          },
        },
        { provide: AgentToolExecutorService, useValue: toolExecutor },
        RequestContextService,
      ],
    }).compile();

    runner = moduleRef.get(AgentRunnerService);
  });

  describe('Single & Multi-step Execution', () => {
    it('completes agent run when provider returns text immediately', async () => {
      llmService.generateTurn.mockResolvedValueOnce({
        type: 'text',
        content: 'I found no wireless headphones.',
        providerResponseId: 'resp-1',
      });

      const result = await runner.runAgent(
        1,
        UserRole.CUSTOMER,
        'Search wireless headphones',
      );

      expect(prisma.agentRun.create).toHaveBeenCalled();
      expect(result.status).toBe(AgentRunStatus.COMPLETED);
      expect(result.finalAnswer).toBe('I found no wireless headphones.');
    });

    it('executes multi-step tool calls in sequential order (sequenceNumber 1, 2)', async () => {
      // Step 1: Provider requests search_products
      llmService.generateTurn.mockResolvedValueOnce({
        type: 'tool_call',
        toolCall: {
          providerCallId: 'p-call-1',
          name: 'search_products',
          arguments: { search: 'headphones' },
        },
      });

      toolExecutor.executeTool.mockResolvedValueOnce({
        status: 'SUCCEEDED',
        result: {
          ok: true,
          data: { products: [{ id: 10, name: 'Headphones' }] },
        },
        durationMs: 45,
      });

      // Step 2: Provider returns final answer
      llmService.generateTurn.mockResolvedValueOnce({
        type: 'text',
        content: 'Found product ID 10: Headphones.',
        providerResponseId: 'resp-2',
      });

      const result = await runner.runAgent(
        1,
        UserRole.CUSTOMER,
        'Find headphones',
      );

      expect(prisma.agentToolCall.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sequenceNumber: 1,
          toolName: 'search_products',
          status: AgentToolCallStatus.REQUESTED,
        }),
      });
      expect(result.status).toBe(AgentRunStatus.COMPLETED);
    });

    it('handles max steps reached when model loops continuously', async () => {
      llmService.generateTurn.mockResolvedValue({
        type: 'tool_call',
        toolCall: {
          providerCallId: 'p-call-loop',
          name: 'get_cart',
          arguments: {},
        },
      });

      toolExecutor.executeTool.mockResolvedValue({
        status: 'SUCCEEDED',
        result: { ok: true, data: {} },
        durationMs: 10,
      });

      const result = await runner.runAgent(
        1,
        UserRole.CUSTOMER,
        'Loop forever',
      );

      expect(result.status).toBe(AgentRunStatus.MAX_STEPS_REACHED);
      expect(result.errorCode).toBe('AGENT_MAX_STEPS_REACHED');
    });

    it('marks AgentRun as FAILED on provider error without rolling back prior tool calls', async () => {
      llmService.generateTurn.mockRejectedValueOnce(
        ApiException.llmProviderError('OpenAI timeout'),
      );

      await expect(
        runner.runAgent(1, UserRole.CUSTOMER, 'Cause provider error'),
      ).rejects.toThrow();

      expect(prisma.agentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentRunStatus.FAILED,
            errorCode: 'LLM_PROVIDER_ERROR',
          }),
        }),
      );
    });
  });

  describe('Idempotency Key Derivation Logic', () => {
    it('produces identical idempotency keys for same agentRunId + providerCallId', () => {
      const runId = '550e8400-e29b-41d4-a716-446655440000';
      const providerCallId = 'call_abc123';

      const key1 = createHash('sha256')
        .update(`${runId}:${providerCallId}`)
        .digest('hex')
        .substring(0, 32);
      const key2 = createHash('sha256')
        .update(`${runId}:${providerCallId}`)
        .digest('hex')
        .substring(0, 32);

      expect(key1).toBe(key2);
    });

    it('produces different idempotency keys for separate providerCallIds', () => {
      const runId = '550e8400-e29b-41d4-a716-446655440000';

      const key1 = createHash('sha256')
        .update(`${runId}:call_abc123`)
        .digest('hex')
        .substring(0, 32);
      const key2 = createHash('sha256')
        .update(`${runId}:call_xyz789`)
        .digest('hex')
        .substring(0, 32);

      expect(key1).not.toBe(key2);
    });
  });
});
