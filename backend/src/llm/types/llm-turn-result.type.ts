import { LlmToolCall } from './llm-tool-call.type';

export interface LlmUsageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmTurnResult {
  providerResponseId?: string;
  type: 'text' | 'tool_call';
  content?: string;
  toolCall?: LlmToolCall;
  usage?: LlmUsageMetrics;
}
