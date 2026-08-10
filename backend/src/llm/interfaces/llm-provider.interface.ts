import { LlmToolDefinition } from '../types/llm-tool-definition.type';
import { LlmTurnResult } from '../types/llm-turn-result.type';

export interface LlmConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  name?: string; // tool_name or tool call id reference
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface LlmProviderTurnOptions {
  model: string;
  systemPrompt: string;
  tools: LlmToolDefinition[];
  conversationHistory: LlmConversationMessage[];
}

export const LLM_PROVIDER = 'LLM_PROVIDER';

/**
 * Provider Abstraction for LLM model interactions.
 * Allows NexaCart to support OpenAI, Claude, Gemini, or local models
 * without coupling tools or business logic to a specific vendor SDK.
 */
export interface LlmProvider {
  readonly providerName: string;

  /**
   * Execute a single model turn given system prompt, tools, and conversation history.
   * Returns either a tool call request or a final text response.
   */
  generateTurn(options: LlmProviderTurnOptions): Promise<LlmTurnResult>;
}
