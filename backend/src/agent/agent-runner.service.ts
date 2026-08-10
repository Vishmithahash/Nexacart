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

  async runAgent(userId: number, role: UserRole, instruction: string) {
    const maxSteps = this.configService.get<number>('AGENT_MAX_STEPS', 10);
    const model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o');
    const providerName = this.llmService.providerName;

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
    const accumulatedUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let lastProviderResponseId: string | undefined;

    try {
      while (currentStep < maxSteps) {
        currentStep++;

        const turnResult = await this.llmService.generateTurn({
          model,
          systemPrompt: BASE_SYSTEM_PROMPT,
          tools: toolDefinitions,
          conversationHistory,
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

        if (turnResult.type === 'tool_call' && turnResult.toolCall) {
          const toolCall = turnResult.toolCall;
          const sequenceNumber = currentStep;

          const createdCall = await this.prisma.agentToolCall.create({
            data: {
              agentRunId: agentRun.id,
              sequenceNumber,
              providerCallId: toolCall.providerCallId,
              toolName: toolCall.name,
              arguments: toolCall.arguments as unknown as Prisma.InputJsonValue,
              status: AgentToolCallStatus.REQUESTED,
              requestId,
              qaRunId,
            },
          });

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
              result: executionResult.result as unknown as Prisma.InputJsonValue,
              durationMs: executionResult.durationMs,
              errorCode: executionResult.errorCode,
              errorMessage: executionResult.errorMessage,
              completedAt: new Date(),
            },
          });

          await this.prisma.agentRun.update({
            where: { id: agentRun.id },
            data: { totalToolCalls: { increment: 1 } },
          });

          conversationHistory.push({
            role: 'assistant',
            tool_calls: [
              {
                id: toolCall.providerCallId,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.arguments),
                },
              },
            ],
          });

          conversationHistory.push({
            role: 'tool',
            tool_call_id: toolCall.providerCallId,
            name: toolCall.name,
            content: JSON.stringify(executionResult.result),
          });
        }
      }

      const maxStepsRun = await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.MAX_STEPS_REACHED,
          providerResponseId: lastProviderResponseId,
          usage: accumulatedUsage as unknown as Prisma.InputJsonValue,
          errorCode: 'AGENT_MAX_STEPS_REACHED',
          errorMessage: `Exceeded maximum step limit of ${maxSteps} tool call turns.`,
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
      const errorObj = err as { errorCode?: string; message?: string };
      this.logger.error(
        `Agent run ${agentRun.id} failed: ${errorObj?.message ?? String(err)}`,
      );

      const failedRun = await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.FAILED,
          providerResponseId: lastProviderResponseId,
          usage: accumulatedUsage as unknown as Prisma.InputJsonValue,
          errorCode: errorObj?.errorCode ?? 'LLM_PROVIDER_ERROR',
          errorMessage: errorObj?.message ?? 'Agent execution failed.',
          completedAt: new Date(),
        },
        include: {
          toolCalls: {
            orderBy: { sequenceNumber: 'asc' },
          },
        },
      });

      if (err instanceof ApiException) {
        throw err;
      }

      return failedRun;
    }
  }
}
