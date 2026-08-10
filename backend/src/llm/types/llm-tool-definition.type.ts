export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
