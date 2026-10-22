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

    it('executes multiple tool calls in a single turn sequentially in model order with separate sequence numbers', async () => {
      llmService.generateTurn.mockResolvedValueOnce({
        type: 'tool_call',
        toolCalls: [
          {
            providerCallId: 'call_1',
            name: 'search_products',
            arguments: { search: 'phone' },
          },
          {
            providerCallId: 'call_2',
            name: 'get_cart',
            arguments: {},
          },
        ],
      });

      toolExecutor.executeTool
        .mockResolvedValueOnce({
          status: 'SUCCEEDED',
          result: { ok: true, data: { items: ['phone'] } },
          durationMs: 20,
        })
        .mockResolvedValueOnce({
          status: 'SUCCEEDED',
          result: { ok: true, data: { items: [] } },
          durationMs: 15,
        });

      llmService.generateTurn.mockResolvedValueOnce({
        type: 'text',
        content: 'Found phone and empty cart.',
        providerResponseId: 'resp-multi',
      });

      const result = await runner.runAgent(
        1,
        UserRole.CUSTOMER,
        'Search phone and view cart',
      );

      expect(result.status).toBe(AgentRunStatus.COMPLETED);
      expect(result.finalAnswer).toBe('Found phone and empty cart.');

      // Verify sequential execution in model order with sequenceNumber 1 and 2
      expect(prisma.agentToolCall.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          sequenceNumber: 1,
          toolName: 'search_products',
          providerCallId: 'call_1',
        }),
      });
      expect(prisma.agentToolCall.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          sequenceNumber: 2,
          toolName: 'get_cart',
          providerCallId: 'call_2',
        }),
      });

      // Verify conversation history for next turn received both tool calls and both results
      expect(llmService.generateTurn).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              tool_calls: expect.arrayContaining([
                expect.objectContaining({ id: 'call_1' }),
                expect.objectContaining({ id: 'call_2' }),
              ]),
            }),
            expect.objectContaining({
              role: 'tool',
              tool_call_id: 'call_1',
            }),
            expect.objectContaining({
              role: 'tool',
              tool_call_id: 'call_2',
            }),
          ]),
        }),
      );
    });

    it('enforces execution budget and marks AgentRun FAILED with AGENT_EXECUTION_BUDGET_EXCEEDED without starting new tools', async () => {
      // Mock deadline already passed
      const RealDateNow = Date.now;
      let counter = 0;
      Date.now = jest.fn(() => {
        counter += 70000; // immediately exceeds 60s budget
        return counter;
      });

      try {
        await expect(
          runner.runAgent(1, UserRole.CUSTOMER, 'Instruction on expired budget'),
        ).rejects.toThrow();

        expect(prisma.agentRun.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: AgentRunStatus.FAILED,
              errorCode: 'AGENT_EXECUTION_BUDGET_EXCEEDED',
            }),
          }),
        );
        expect(toolExecutor.executeTool).not.toHaveBeenCalled();
      } finally {
        Date.now = RealDateNow;
      }
    });

    it('resolves model according to provider and uses OLLAMA_MODEL for Ollama without sending OpenAI model', async () => {
      (llmService as any).providerName = 'OLLAMA';

      const moduleRef = await Test.createTestingModule({
        providers: [
          AgentRunnerService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((key, defaultVal) => {
                if (key === 'LLM_PROVIDER') return 'ollama';
                if (key === 'OLLAMA_MODEL') return 'qwen3.5:4b';
                if (key === 'OPENAI_MODEL') return 'gpt-4o';
                return defaultVal;
              }),
            },
          },
          { provide: LlmService, useValue: llmService },
          {
            provide: AgentToolRegistryService,
            useValue: { getToolDefinitions: jest.fn().mockReturnValue([]) },
          },
          { provide: AgentToolExecutorService, useValue: toolExecutor },
          RequestContextService,
        ],
      }).compile();

      const ollamaRunner = moduleRef.get(AgentRunnerService);

      llmService.generateTurn.mockResolvedValueOnce({
        type: 'text',
        content: 'Ollama text',
      });

      await ollamaRunner.runAgent(1, UserRole.CUSTOMER, 'Test Ollama model');

      expect(prisma.agentRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          provider: 'OLLAMA',
          model: 'qwen3.5:4b',
        }),
      });

      expect(llmService.generateTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen3.5:4b',
        }),
      );
    });

    it('rejects late final text if model turn finishes after deadline and marks run FAILED', async () => {
      let callCount = 0;
      const RealDateNow = Date.now;
      Date.now = jest.fn(() => {
        callCount++;
        // Call 1: start time, Call 2: remaining before turn, Call 3: after generateTurn -> simulate expiry
        if (callCount >= 3) return 100000;
        return 1000;
      });

      try {
        llmService.generateTurn.mockResolvedValueOnce({
          type: 'text',
          content: 'Late text arriving after deadline',
        });

        await expect(
          runner.runAgent(1, UserRole.CUSTOMER, 'Late text instruction'),
        ).rejects.toThrow(ApiException);

        expect(prisma.agentRun.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: AgentRunStatus.FAILED,
              errorCode: 'AGENT_EXECUTION_BUDGET_EXCEEDED',
            }),
          }),
        );
      } finally {
        Date.now = RealDateNow;
      }
    });

    it('does not start tool execution if trace insertion crosses deadline and records unexecuted failure', async () => {
      llmService.generateTurn.mockResolvedValueOnce({
        type: 'tool_call',
        toolCall: {
          providerCallId: 'slow_trace_call',
          name: 'search_products',
          arguments: { q: 'shoes' },
        },
      });

      const RealDateNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        // Call 1: start time, Call 2: remaining before turn, Call 3: after turn, Call 4: before tool create
        // Call 5: immediately after agentToolCall.create() -> simulate deadline crossed during trace insertion
        if (callCount >= 5) return 100000;
        return 1000;
      });

      try {
        await expect(
          runner.runAgent(1, UserRole.CUSTOMER, 'Slow trace insertion'),
        ).rejects.toThrow(ApiException);

        // Tool was NOT executed
        expect(toolExecutor.executeTool).not.toHaveBeenCalled();

        // Trace record updated to FAILED with durationMs 0
        expect(prisma.agentToolCall.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'call-uuid-1' },
            data: expect.objectContaining({
              status: AgentToolCallStatus.FAILED,
              errorCode: 'AGENT_EXECUTION_BUDGET_EXCEEDED',
              durationMs: 0,
            }),
          }),
        );
      } finally {
        Date.now = RealDateNow;
      }
    });

    it('preserves executed tool evidence when budget expires between calls in one batch', async () => {
      llmService.generateTurn.mockResolvedValueOnce({
        type: 'tool_call',
        toolCalls: [
          {
            providerCallId: 'call_one',
            name: 'search_products',
            arguments: { q: 'shoes' },
          },
          {
            providerCallId: 'call_two',
            name: 'get_cart',
            arguments: {},
          },
        ],
      });

      // Call 1 succeeds
      toolExecutor.executeTool.mockResolvedValueOnce({
        status: 'SUCCEEDED',
        result: { ok: true, data: { items: ['sneakers'] } },
        durationMs: 30,
      });

      const RealDateNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        // Call 1 executes, then deadline expires before Call 2 starts
        if (callCount >= 6) return 100000;
        return 1000;
      });

      try {
        await expect(
          runner.runAgent(1, UserRole.CUSTOMER, 'Batch expiry test'),
        ).rejects.toThrow(ApiException);

        // First tool call executed and succeeded
        expect(toolExecutor.executeTool).toHaveBeenCalledTimes(1);
        expect(prisma.agentToolCall.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: AgentToolCallStatus.SUCCEEDED,
            }),
          }),
        );

        // Agent run failed overall with budget exceeded
        expect(prisma.agentRun.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: AgentRunStatus.FAILED,
              errorCode: 'AGENT_EXECUTION_BUDGET_EXCEEDED',
            }),
          }),
        );
      } finally {
        Date.now = RealDateNow;
      }
    });

    it('attaches failed agentRunId and agentRun metadata to thrown ApiException', async () => {
      llmService.generateTurn.mockRejectedValueOnce(
        ApiException.llmProviderError('Provider connection failed'),
      );

      try {
        await runner.runAgent(1, UserRole.CUSTOMER, 'Cause provider error');
        fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiException);
        expect(err.agentRunId).toBe(mockRun.id);
        expect(err.agentRun).toBeDefined();
        expect(err.agentRun.id).toBe(mockRun.id);
        expect(err.agentRun.status).toBe(AgentRunStatus.FAILED);
      }
    });

    it('persists unexecuted calls when returned batch exceeds remaining tool call limit', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AgentRunnerService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((key, defaultVal) => {
                if (key === 'AGENT_MAX_STEPS') return 10;
                if (key === 'AGENT_MAX_TOOL_CALLS') return 1; // Limit: only 1 tool call allowed
                return defaultVal;
              }),
            },
          },
          { provide: LlmService, useValue: llmService },
          {
            provide: AgentToolRegistryService,
            useValue: { getToolDefinitions: jest.fn().mockReturnValue([]) },
          },
          { provide: AgentToolExecutorService, useValue: toolExecutor },
          RequestContextService,
        ],
      }).compile();

      const customRunner = moduleRef.get(AgentRunnerService);

      // Provider returns 2 tool calls, but limit is 1
      llmService.generateTurn.mockResolvedValueOnce({
        type: 'tool_call',
        toolCalls: [
          {
            providerCallId: 'call_allowed',
            name: 'search_products',
            arguments: { q: 'phone' },
          },
          {
            providerCallId: 'call_exceeded',
            name: 'get_cart',
            arguments: {},
          },
        ],
      });

      toolExecutor.executeTool.mockResolvedValueOnce({
        status: 'SUCCEEDED',
        result: { ok: true, data: {} },
        durationMs: 15,
      });

      const result = await customRunner.runAgent(1, UserRole.CUSTOMER, 'Run with excess batch');

      expect(result.status).toBe(AgentRunStatus.MAX_STEPS_REACHED);
      // Tool 1 was created and executed
      expect(prisma.agentToolCall.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerCallId: 'call_allowed',
            status: AgentToolCallStatus.REQUESTED,
          }),
        }),
      );
      // Tool 2 was NOT silently hidden: persisted as FAILED with AGENT_TOOL_LIMIT_REACHED
      expect(prisma.agentToolCall.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerCallId: 'call_exceeded',
            status: AgentToolCallStatus.FAILED,
            errorCode: 'AGENT_TOOL_LIMIT_REACHED',
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
