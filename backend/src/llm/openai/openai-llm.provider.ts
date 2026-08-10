import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  LlmProvider,
  LlmProviderTurnOptions,
} from '../interfaces/llm-provider.interface';
import { LlmTurnResult } from '../types/llm-turn-result.type';

@Injectable()
export class OpenAiLlmProvider implements LlmProvider {
  readonly providerName = 'OPENAI';
  private readonly logger = new Logger(OpenAiLlmProvider.name);
  private openaiClient: OpenAI | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey && apiKey.trim().length > 0) {
      this.openaiClient = new OpenAI({ apiKey: apiKey.trim() });
    }
  }

  async generateTurn(options: LlmProviderTurnOptions): Promise<LlmTurnResult> {
    if (!this.openaiClient) {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (apiKey && apiKey.trim().length > 0) {
        this.openaiClient = new OpenAI({ apiKey: apiKey.trim() });
      } else {
        throw ApiException.llmNotConfigured(
          'OPENAI_API_KEY is not configured on the server.',
        );
      }
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.systemPrompt },
      ...options.conversationHistory.map((msg) => {
        if (msg.role === 'tool') {
          return {
            role: 'tool' as const,
            content: msg.content ?? '',
            tool_call_id: msg.tool_call_id!,
          };
        }
        if (msg.role === 'assistant' && msg.tool_calls) {
          return {
            role: 'assistant' as const,
            content: msg.content ?? null,
            tool_calls: msg.tool_calls,
          };
        }
        return {
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content ?? '',
        };
      }),
    ];

    const tools: OpenAI.Chat.ChatCompletionTool[] = options.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: true,
      },
    }));

    try {
      let response: any;

      // Migrate to OpenAI Responses API when responses.create is supported by SDK / backend
      const responsesApi = (this.openaiClient as any).responses;
      if (responsesApi && typeof responsesApi.create === 'function') {
        response = await responsesApi.create({
          model: options.model,
          instructions: options.systemPrompt,
          input: messages,
          tools: tools.length > 0 ? tools : undefined,
          parallel_tool_calls: false,
        });
      } else {
        response = await this.openaiClient.chat.completions.create({
          model: options.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          parallel_tool_calls: false,
        });
      }

      const choice = response.choices?.[0] ?? response.output?.[0];
      const message = choice?.message ?? choice;

      if (!message && !response.output_text) {
        throw ApiException.llmInvalidResponse(
          'No valid choice or response returned from OpenAI.',
        );
      }

      const usage = response.usage
        ? {
            promptTokens:
              response.usage.prompt_tokens ?? response.usage.input_tokens,
            completionTokens:
              response.usage.completion_tokens ?? response.usage.output_tokens,
            totalTokens:
              response.usage.total_tokens ??
              ((response.usage.input_tokens ?? 0) +
                (response.usage.output_tokens ?? 0)),
          }
        : undefined;

      const toolCalls = message?.tool_calls ?? response.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        const firstCall = toolCalls[0];
        if (firstCall.type === 'function' || firstCall.function) {
          const argsStr =
            firstCall.function?.arguments ?? firstCall.arguments ?? '{}';
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(argsStr) as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }

          return {
            providerResponseId: response.id,
            type: 'tool_call',
            toolCall: {
              providerCallId: firstCall.id ?? firstCall.call_id,
              name: firstCall.function?.name ?? firstCall.name,
              arguments: parsedArgs,
            },
            usage,
          };
        }
      }

      const textContent =
        message?.content ?? response.output_text ?? response.content ?? '';

      return {
        providerResponseId: response.id,
        type: 'text',
        content: textContent,
        usage,
      };
    } catch (err: unknown) {
      if (err instanceof ApiException) throw err;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenAI API error: ${errorMessage}`);
      throw ApiException.llmProviderError(
        `OpenAI provider error: ${errorMessage}`,
      );
    }
  }
}
