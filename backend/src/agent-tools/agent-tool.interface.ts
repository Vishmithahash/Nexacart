import { UserRole } from '../generated/prisma/client';

export interface AgentExecutionContext {
  userId: number;
  role: UserRole;
  agentRunId: string;
  requestId?: string;
  qaRunId?: string;
}

export interface StandardToolResultEnvelope {
  ok: boolean;
  data?: unknown;
  error?: {
    errorCode: string;
    message: string;
    statusCode: number;
  };
}

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly isStateChanging: boolean;

  execute(
    args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope>;
}
