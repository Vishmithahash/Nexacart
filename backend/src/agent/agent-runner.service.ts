import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ApiException } from '../common/exceptions/api.exception';
import { LlmService } from '../llm/llm.service';
import { LlmConversationMessage } from '../llm/interfaces/llm-provider.interface';
import { AgentToolRegistryService } from '../agent-tools/agent-tool-registry.service';
import { AgentToolExecutorService } from '../agent-tools/agent-tool-executor.service';
import { AgentExecutionContext } from '../agent-tools/agent-tool.interface';
import {
  AgentRunStatus,
  AgentToolCallStatus,
  UserRole,
  Prisma,
} from '../generated/prisma/client';

export const SYSTEM_PROMPT_VERSION = 'nexacart-customer-agent-v1';
export const BASE_SYSTEM_PROMPT = `You are the NexaCart customer assistant.

Act only on behalf of the authenticated customer.

Use only the tools provided to you.

Never invent product IDs, cart-item IDs, order numbers or tool results.

Never claim that a state-changing action succeeded unless the corresponding tool reports success.

If required information is missing, use an appropriate read tool or ask the user for clarification.

When a tool returns an error, use the actual error information rather than inventing a successful result.`;

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly toolRegistry: AgentToolRegistryService,
    private readonly toolExecutor: AgentToolExecutorService,
    private readonly requestContextService: RequestContextService,
  ) {}

  private resolveModel(providerName: string): string {
    const rawProvider = (
      this.configService.get<string>('LLM_PROVIDER', 'openai') || 'openai'
    )
      .trim()
      .toLowerCase();

    if (rawProvider === 'ollama' || providerName.toUpperCase() === 'OLLAMA') {
      return this.configService.get<string>('OLLAMA_MODEL', 'qwen3.5:4b');
    }

    return this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  async runAgent(userId: number, role: UserRole, instruction: string) {
    const maxSteps = this.configService.get<number>('AGENT_MAX_STEPS', 10);
    const maxToolCalls = this.configService.get<number>(
      'AGENT_MAX_TOOL_CALLS',
      maxSteps * 2,
    );
    const runTimeoutMs = this.configService.get<number>(
      'AGENT_RUN_TIMEOUT_MS',
      60000,
    );

    const providerName = this.llmService.providerName;
    const model = this.resolveModel(providerName);

    const requestId = this.requestContextService.getRequestId();
    const qaRunId = this.requestContextService.getQaRunId();

    const agentRun = await this.prisma.agentRun.create({
      data: {
        userId,
        provider: providerName,
        model,
        systemPromptVersion: SYSTEM_PROMPT_VERSION,
        instruction,
        status: AgentRunStatus.RUNNING,
        requestId,
        qaRunId,
      },
    });

    const executionContext: AgentExecutionContext = {
      userId,
      role,
      agentRunId: agentRun.id,
      requestId,
      qaRunId,
    };

    const toolDefinitions = this.toolRegistry.getToolDefinitions();
    const conversationHistory: LlmConversationMessage[] = [
      { role: 'user', content: instruction },
    ];

    let currentStep = 0;
    let totalToolCallsExecuted = 0;
    let toolSequenceNumber = 0;
    const accumulatedUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let lastProviderResponseId: string | undefined;

    const runStartTime = Date.now();
    const deadline = runStartTime + runTimeoutMs;

    try {
      while (currentStep < maxSteps && totalToolCallsExecuted < maxToolCalls) {
        currentStep++;

        const remainingBeforeTurn = deadline - Date.now();
        if (remainingBeforeTurn <= 0) {
          throw ApiException.agentExecutionBudgetExceeded(
            `Agent run exceeded execution budget of ${runTimeoutMs}ms before step ${currentStep}.`,
          );
        }

        const turnResult = await this.llmService.generateTurn({
          model,
          systemPrompt: BASE_SYSTEM_PROMPT,
          tools: toolDefinitions,
          conversationHistory,
          timeoutMs: remainingBeforeTurn,
        });

        if (turnResult.providerResponseId) {
          lastProviderResponseId = turnResult.providerResponseId;
        }

        if (turnResult.usage) {
          accumulatedUsage.promptTokens += turnResult.usage.promptTokens ?? 0;
          accumulatedUsage.completionTokens +=
            turnResult.usage.completionTokens ?? 0;
          accumulatedUsage.totalTokens += turnResult.usage.totalTokens ?? 0;
        }

        // Check deadline after generateTurn resolves, before accepting final text or processing tool calls
        if (Date.now() >= deadline) {
          throw ApiException.agentExecutionBudgetExceeded(
            `Agent run exceeded execution budget of ${runTimeoutMs}ms after step ${currentStep} model turn.`,
          );
        }

        if (turnResult.type === 'text') {
          const completedRun = await this.prisma.agentRun.update({
            where: { id: agentRun.id },
            data: {
              status: AgentRunStatus.COMPLETED,
              finalAnswer: turnResult.content,
              providerResponseId: lastProviderResponseId,
              usage: accumulatedUsage,
              completedAt: new Date(),
            },
            include: {
              toolCalls: {
                orderBy: { sequenceNumber: 'asc' },
              },
            },
          });
          return completedRun;
        }

        if (turnResult.type === 'tool_call') {
          const callsToExecute =
            turnResult.toolCalls && turnResult.toolCalls.length > 0
              ? turnResult.toolCalls
              : turnResult.toolCall
                ? [turnResult.toolCall]
                : [];

          if (callsToExecute.length === 0) {
            throw ApiException.llmInvalidResponse(
              'Turn result indicated tool_call but provided no tool calls.',
            );
          }

          const executedCallsForTurn: Array<{
            toolCall: (typeof callsToExecute)[number];
            result: unknown;
          }> = [];

          for (const toolCall of callsToExecute) {
            if (totalToolCallsExecuted >= maxToolCalls) {
              this.logger.warn(
                `Agent run ${agentRun.id} reached bounded tool-call limit of ${maxToolCalls}.`,
              );
              // Do not silently hide unexecuted calls when a returned batch exceeds remaining allowance
              toolSequenceNumber++;
              await this.prisma.agentToolCall.create({
                data: {
                  agentRunId: agentRun.id,
                  sequenceNumber: toolSequenceNumber,
                  providerCallId: toolCall.providerCallId,
                  toolName: toolCall.name,
                  arguments:
                    toolCall.arguments as unknown as Prisma.InputJsonValue,
                  status: AgentToolCallStatus.FAILED,
                  errorCode: 'AGENT_TOOL_LIMIT_REACHED',
                  errorMessage: `Tool call skipped: exceeded bounded tool call limit of ${maxToolCalls}.`,
                  durationMs: 0,
                  requestId,
                  qaRunId,
                  completedAt: new Date(),
                },
              });
              continue;
            }

            if (Date.now() >= deadline) {
              throw ApiException.agentExecutionBudgetExceeded(
                `Agent run exceeded execution budget of ${runTimeoutMs}ms before executing tool "${toolCall.name}".`,
              );
            }

            toolSequenceNumber++;
            const sequenceNumber = toolSequenceNumber;

            const createdCall = await this.prisma.agentToolCall.create({
              data: {
                agentRunId: agentRun.id,
                sequenceNumber,
                providerCallId: toolCall.providerCallId,
                toolName: toolCall.name,
                arguments:
                  toolCall.arguments as unknown as Prisma.InputJsonValue,
                status: AgentToolCallStatus.REQUESTED,
                requestId,
                qaRunId,
              },
            });

            // Check immediately before actual tool execution, including after awaiting agentToolCall.create()
            if (Date.now() >= deadline) {
              await this.prisma.agentToolCall.update({
                where: { id: createdCall.id },
                data: {
                  status: AgentToolCallStatus.FAILED,
                  errorCode: 'AGENT_EXECUTION_BUDGET_EXCEEDED',
                  errorMessage: `Agent execution budget exceeded before executing tool "${toolCall.name}".`,
                  durationMs: 0,
                  completedAt: new Date(),
                },
              });
              throw ApiException.agentExecutionBudgetExceeded(
                `Agent run exceeded execution budget of ${runTimeoutMs}ms before executing tool "${toolCall.name}".`,
              );
            }

            const executionResult = await this.toolExecutor.executeTool(
              {
                agentToolCallId: createdCall.id,
                toolName: toolCall.name,
                arguments: toolCall.arguments,
                providerCallId: toolCall.providerCallId,
                sequenceNumber,
              },
              executionContext,
            );

            const updatedCallStatus =
              executionResult.status === 'SUCCEEDED'
                ? AgentToolCallStatus.SUCCEEDED
                : executionResult.status === 'INVALID_ARGUMENTS'
                  ? AgentToolCallStatus.INVALID_ARGUMENTS
                  : AgentToolCallStatus.FAILED;

            await this.prisma.agentToolCall.update({
              where: { id: createdCall.id },
              data: {
                status: updatedCallStatus,
                result:
                  executionResult.result as unknown as Prisma.InputJsonValue,
                durationMs: executionResult.durationMs,
                errorCode: executionResult.errorCode,
                errorMessage: executionResult.errorMessage,
                completedAt: new Date(),
              },
            });

            totalToolCallsExecuted++;
            await this.prisma.agentRun.update({
              where: { id: agentRun.id },
              data: { totalToolCalls: { increment: 1 } },
            });

            executedCallsForTurn.push({
              toolCall,
              result: executionResult.result,
            });
          }

          if (executedCallsForTurn.length > 0) {
            conversationHistory.push({
              role: 'assistant',
              tool_calls: executedCallsForTurn.map(({ toolCall }) => ({
                id: toolCall.providerCallId,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.arguments),
                },
              })),
            });

            for (const { toolCall, result } of executedCallsForTurn) {
              conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.providerCallId,
                name: toolCall.name,
                content: JSON.stringify(result),
              });
            }
          }

          // Check boundary after tools execution
          if (Date.now() >= deadline) {
            throw ApiException.agentExecutionBudgetExceeded(
              `Agent run exceeded execution budget of ${runTimeoutMs}ms after step ${currentStep} tool execution.`,
            );
          }

          if (totalToolCallsExecuted >= maxToolCalls) {
            break;
          }
        }
      }

      // Check boundary before terminal status selection so expired runs are not mislabeled
      if (Date.now() >= deadline) {
        throw ApiException.agentExecutionBudgetExceeded(
          `Agent run exceeded execution budget of ${runTimeoutMs}ms.`,
        );
      }

      const maxStepsRun = await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.MAX_STEPS_REACHED,
          providerResponseId: lastProviderResponseId,
          usage: accumulatedUsage,
          errorCode: 'AGENT_MAX_STEPS_REACHED',
          errorMessage:
            totalToolCallsExecuted >= maxToolCalls
              ? `Exceeded bounded tool call limit of ${maxToolCalls} tool calls.`
              : `Exceeded maximum step limit of ${maxSteps} tool call turns.`,
          completedAt: new Date(),
        },
        include: {
          toolCalls: {
            orderBy: { sequenceNumber: 'asc' },
          },
        },
      });

      return maxStepsRun;
    } catch (err: unknown) {
      let errorCode = 'LLM_PROVIDER_ERROR';
      let errorMessage = 'Agent execution failed.';

      if (err instanceof ApiException) {
        errorCode = err.errorCode;
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message || errorMessage;
        const errRecord = err as unknown as Record<string, unknown>;
        if (
          typeof errRecord.errorCode === 'string' &&
          errRecord.errorCode.trim().length > 0
        ) {
          errorCode = errRecord.errorCode.trim();
        }
      } else if (typeof err === 'string') {
        const trimmed = err.trim();
        if (trimmed.length > 0) {
          errorMessage = trimmed;
        }
      } else if (typeof err === 'object' && err !== null) {
        const obj = err as Record<string, unknown>;
        if (typeof obj.message === 'string' && obj.message.trim().length > 0) {
          errorMessage = obj.message.trim();
        }
        if (typeof obj.errorCode === 'string' && obj.errorCode.trim().length > 0) {
          errorCode = obj.errorCode.trim();
        }
      }

      this.logger.error(
        `Agent run ${agentRun.id} failed: [${errorCode}] ${errorMessage}`,
      );

      const failedRun = await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.FAILED,
          providerResponseId: lastProviderResponseId,
          usage: accumulatedUsage,
          errorCode,
          errorMessage,
          completedAt: new Date(),
        },
        include: {
          toolCalls: {
            orderBy: { sequenceNumber: 'asc' },
          },
        },
      });

      if (err instanceof ApiException) {
        err.withAgentRun(failedRun, agentRun.id);
        throw err;
      }

      if (typeof err === 'object' && err !== null) {
        try {
          (err as Record<string, unknown>).agentRunId = agentRun.id;
          (err as Record<string, unknown>).agentRun = failedRun;
        } catch {
          // Object may be non-extensible or frozen
        }
      }

      return failedRun;
    }
  }
}
