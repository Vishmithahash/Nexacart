import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { RequestContextService } from '../common/request-context/request-context.service';
import {
  AgentExecutionContext,
  StandardToolResultEnvelope,
} from './agent-tool.interface';
import { AgentToolRegistryService } from './agent-tool-registry.service';

export interface ExecuteToolInput {
  agentToolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  providerCallId?: string;
  sequenceNumber: number;
}

export interface ExecuteToolResult {
  status: 'SUCCEEDED' | 'FAILED' | 'INVALID_ARGUMENTS';
  result: StandardToolResultEnvelope;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}

@Injectable()
export class AgentToolExecutorService {
  private readonly logger = new Logger(AgentToolExecutorService.name);

  constructor(
    private readonly toolRegistry: AgentToolRegistryService,
    private readonly requestContextService: RequestContextService,
  ) {}

  async executeTool(
    input: ExecuteToolInput,
    context: AgentExecutionContext,
  ): Promise<ExecuteToolResult> {
    const startTime = Date.now();

    const tool = this.toolRegistry.getTool(input.toolName);
    if (!tool) {
      const durationMs = Date.now() - startTime;
      return {
        status: 'INVALID_ARGUMENTS',
        result: {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_NOT_FOUND',
            message: `Tool "${input.toolName}" is not registered or permitted.`,
            statusCode: 400,
          },
        },
        durationMs,
        errorCode: 'AGENT_TOOL_NOT_FOUND',
        errorMessage: `Tool "${input.toolName}" is not registered or permitted.`,
      };
    }

    // Derive deterministic idempotency key for state-changing tools based on runId + providerCallId
    const keySeed = `${context.agentRunId}:${input.providerCallId ?? input.sequenceNumber}`;
    const derivedIdempotencyKey = createHash('sha256')
      .update(keySeed)
      .digest('hex')
      .substring(0, 32);

    const enrichedContext: AgentExecutionContext & {
      derivedIdempotencyKey: string;
    } = {
      ...context,
      derivedIdempotencyKey,
    };

    try {
      // Execute tool inside a RequestContext scope overriding toolCallId = input.agentToolCallId
      const envelope = await this.requestContextService.runWithOverrides(
        { toolCallId: input.agentToolCallId },
        () => tool.execute(input.arguments, enrichedContext),
      );

      const durationMs = Date.now() - startTime;

      if (envelope.ok) {
        return {
          status: 'SUCCEEDED',
          result: envelope,
          durationMs,
        };
      } else {
        return {
          status:
            envelope.error?.errorCode === 'AGENT_TOOL_INVALID_ARGUMENTS'
              ? 'INVALID_ARGUMENTS'
              : 'FAILED',
          result: envelope,
          durationMs,
          errorCode: envelope.error?.errorCode ?? 'AGENT_TOOL_EXECUTION_FAILED',
          errorMessage: envelope.error?.message,
        };
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const message = err?.message ?? 'Unexpected tool execution error';
      this.logger.error(`Error executing tool ${input.toolName}: ${message}`);

      return {
        status: 'FAILED',
        result: {
          ok: false,
          error: {
            errorCode: err?.errorCode ?? 'AGENT_TOOL_EXECUTION_FAILED',
            message,
            statusCode: err?.status ?? 400,
          },
        },
        durationMs,
        errorCode: err?.errorCode ?? 'AGENT_TOOL_EXECUTION_FAILED',
        errorMessage: message,
      };
    }
  }
}
