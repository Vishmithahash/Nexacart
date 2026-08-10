export interface LlmToolCall {
  providerCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}
