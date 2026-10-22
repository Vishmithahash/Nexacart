import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  LlmConversationMessage,
  LlmProvider,
  LlmProviderTurnOptions,
} from '../interfaces/llm-provider.interface';
import { LlmToolCall } from '../types/llm-tool-call.type';
import { LlmTurnResult, LlmUsageMetrics } from '../types/llm-turn-result.type';

interface OllamaToolCallFunction {
  name: string;
  arguments: Record<string, unknown> | string;
}

interface OllamaToolCall {
  id?: string;
  call_id?: string;
  function?: OllamaToolCallFunction;
  name?: string;
  arguments?: Record<string, unknown> | string;
}

interface OllamaChatMessage {
  role: string;
  content?: string;
  thinking?: string;
  tool_name?: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChatResponse {
  model?: string;
  created_at?: string;
  message?: OllamaChatMessage;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

@Injectable()
export class OllamaLlmProvider implements LlmProvider {
  readonly providerName = 'OLLAMA';
  private readonly logger = new Logger(OllamaLlmProvider.name);

  constructor(private readonly configService: ConfigService) {}

  private getBaseUrl(): string {
    const rawUrl =
      this.configService.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      ) || 'http://localhost:11434';
    return rawUrl.trim().replace(/\/+$/, '');
  }

  private getRequestTimeoutMs(): number {
    return this.configService.get<number>('OLLAMA_REQUEST_TIMEOUT_MS', 180000);
  }

  private getNumCtx(): number {
    return this.configService.get<number>('OLLAMA_NUM_CTX', 8192);
  }

  async generateTurn(options: LlmProviderTurnOptions): Promise<LlmTurnResult> {
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/api/chat`;

    if (options.signal?.aborted) {
      throw ApiException.agentExecutionBudgetExceeded(
        'Execution budget exceeded before starting Ollama request.',
      );
    }
    if (options.timeoutMs !== undefined && options.timeoutMs <= 0) {
      throw ApiException.agentExecutionBudgetExceeded(
        'Execution budget exceeded before starting Ollama request.',
      );
    }

    const configuredTimeout = this.getRequestTimeoutMs();
    const effectiveTimeout =
      options.timeoutMs && options.timeoutMs > 0
        ? Math.min(configuredTimeout, options.timeoutMs)
        : configuredTimeout;

    const messages = this.translateHistoryToOllama(
      options.systemPrompt,
      options.conversationHistory,
    );

    const tools =
      options.tools && options.tools.length > 0
        ? options.tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    const numCtx = this.getNumCtx();
    const requestBody: Record<string, unknown> = {
      model: options.model,
      stream: false,
      messages,
      options: {
        num_ctx: numCtx,
      },
    };

    if (tools) {
      requestBody.tools = tools;
    }

    const abortController = new AbortController();
    let timedOut = false;
    let budgetExceeded = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, effectiveTimeout);

    let externalSignalHandler: (() => void) | undefined;
    if (options.signal) {
      externalSignalHandler = () => {
        budgetExceeded = true;
        abortController.abort();
      };
      options.signal.addEventListener('abort', externalSignalHandler, {
        once: true,
      });
    }

    try {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });
      } catch (err: unknown) {
        if (budgetExceeded || options.signal?.aborted) {
          throw ApiException.agentExecutionBudgetExceeded(
            'Execution budget exceeded during Ollama request.',
          );
        }
        if (timedOut) {
          throw ApiException.llmProviderError(
            `Ollama request timed out after ${effectiveTimeout}ms.`,
          );
        }
        if (abortController.signal.aborted) {
          throw ApiException.agentExecutionBudgetExceeded(
            'Execution budget exceeded during Ollama request.',
          );
        }
        const rawMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(`Ollama network error at ${endpoint}: ${rawMessage}`);
        throw ApiException.llmProviderError(
          `Ollama server unreachable at ${baseUrl}. Ensure Ollama is running. (${rawMessage})`,
        );
      }

      let responseText = '';
      try {
        responseText = await response.text();
      } catch (err: unknown) {
        if (budgetExceeded || options.signal?.aborted) {
          throw ApiException.agentExecutionBudgetExceeded(
            'Execution budget exceeded during Ollama response body reading.',
          );
        }
        if (timedOut) {
          throw ApiException.llmProviderError(
            `Ollama request timed out after ${effectiveTimeout}ms.`,
          );
        }
        if (abortController.signal.aborted) {
          throw ApiException.agentExecutionBudgetExceeded(
            'Execution budget exceeded during Ollama response body reading.',
          );
        }
        throw ApiException.llmInvalidResponse(
          `Failed to read response body from Ollama: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!response.ok) {
        this.handleHttpError(response.status, responseText, options.model);
      }

      let responseJson: OllamaChatResponse;
      try {
        responseJson = JSON.parse(responseText) as OllamaChatResponse;
      } catch {
        throw ApiException.llmInvalidResponse(
          'Failed to parse response from Ollama as valid JSON.',
        );
      }

      if (!responseJson || typeof responseJson !== 'object') {
        throw ApiException.llmInvalidResponse(
          'Ollama returned invalid non-object response.',
        );
      }

      if (responseJson.error) {
        this.handleHttpError(response.status, responseJson.error, options.model);
      }

      // Require a completed response before accepting any tool calls.
      // Reject missing/false done and length-truncated generation.
      if (responseJson.done !== true || responseJson.done_reason === 'length') {
        throw ApiException.llmProviderError(
          'Ollama generation was truncated or incomplete (context length limit reached or stream interrupted).',
        );
      }

      const message = responseJson.message;
      if (!message || typeof message !== 'object') {
        throw ApiException.llmInvalidResponse(
          'No message structure returned in Ollama chat response.',
        );
      }

      if (
        message.content !== undefined &&
        message.content !== null &&
        typeof message.content !== 'string'
      ) {
        throw ApiException.llmInvalidResponse(
          'Ollama message content must be a string.',
        );
      }

      if (
        message.thinking !== undefined &&
        message.thinking !== null &&
        typeof message.thinking !== 'string'
      ) {
        throw ApiException.llmInvalidResponse(
          'Ollama message thinking must be a string.',
        );
      }

      const usage: LlmUsageMetrics | undefined =
        responseJson.prompt_eval_count !== undefined ||
        responseJson.eval_count !== undefined
          ? {
              promptTokens: responseJson.prompt_eval_count,
              completionTokens: responseJson.eval_count,
              totalTokens:
                (responseJson.prompt_eval_count ?? 0) +
                (responseJson.eval_count ?? 0),
            }
          : undefined;

      const providerResponseId = `ollama-${Date.now()}-${randomUUID().substring(0, 8)}`;

      // Validate tool_calls shape if present
      if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
        throw ApiException.llmInvalidResponse(
          'Tool calls returned by Ollama must be an array.',
        );
      }

      // Process structured tool calls (never extract tool calls from text or thinking)
      const rawToolCalls = message.tool_calls;
      if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
        const parsedCalls: LlmToolCall[] = [];

        for (const tc of rawToolCalls) {
          if (!tc || typeof tc !== 'object') {
            throw ApiException.llmInvalidResponse(
              'Malformed tool call item in Ollama response.',
            );
          }
          const fn = tc.function;
          if (fn !== undefined && (typeof fn !== 'object' || fn === null)) {
            throw ApiException.llmInvalidResponse(
              'Tool call function property must be an object.',
            );
          }
          const name = fn?.name ?? tc.name;
          if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw ApiException.llmInvalidResponse(
              'Tool call returned by Ollama is missing a valid function name.',
            );
          }

          const rawArgs = fn?.arguments ?? tc.arguments;
          let parsedArgs: Record<string, unknown>;

          if (
            typeof rawArgs === 'object' &&
            rawArgs !== null &&
            !Array.isArray(rawArgs)
          ) {
            parsedArgs = rawArgs;
          } else if (typeof rawArgs === 'string') {
            try {
              const parsed: unknown = JSON.parse(rawArgs);
              if (
                typeof parsed !== 'object' ||
                parsed === null ||
                Array.isArray(parsed)
              ) {
                throw new Error('Parsed tool arguments must be a JSON object.');
              }
              parsedArgs = parsed as Record<string, unknown>;
            } catch (parseErr: unknown) {
              const msg =
                parseErr instanceof Error ? parseErr.message : String(parseErr);
              throw ApiException.llmInvalidResponse(
                `Malformed JSON in tool call arguments for "${name}": ${msg}`,
              );
            }
          } else {
            throw ApiException.llmInvalidResponse(
              `Malformed arguments for tool call "${name}". Expected JSON object or string, received ${typeof rawArgs}.`,
            );
          }

          const callId =
            tc.id ??
            tc.call_id ??
            `call_ollama_${randomUUID().replace(/-/g, '')}`;

          parsedCalls.push({
            providerCallId: callId,
            name: name.trim(),
            arguments: parsedArgs,
          });
        }

        if (parsedCalls.length > 0) {
          return {
            providerResponseId,
            type: 'tool_call',
            toolCall: parsedCalls[0],
            toolCalls: parsedCalls,
            usage,
          };
        }
      }

      // Process final assistant text:
      // - Do not expose message.thinking as final text.
      // - Filter both complete (<think>...</think>) and incomplete (<think>...) thinking blocks.
      // - Documented filtering behavior: Strip reasoning tags produced by reasoning/thinking models
      //   to ensure only final customer-facing responses are returned, while rejecting reasoning-only
      //   or unfinished thinking turns.
      const rawContent = typeof message.content === 'string' ? message.content : '';
      const sanitizedContent = rawContent
        .replace(/<think>[\s\S]*?<\/think>/gi, '') // Strip complete thinking blocks
        .replace(/<think>[\s\S]*$/gi, '')          // Strip unclosed/unfinished thinking blocks
        .trim();

      if (sanitizedContent.length === 0) {
        throw ApiException.llmInvalidResponse(
          'Ollama returned empty final text content with no tool calls.',
        );
      }

      return {
        providerResponseId,
        type: 'text',
        content: sanitizedContent,
        usage,
      };
    } finally {
      clearTimeout(timeoutHandle);
      if (options.signal && externalSignalHandler) {
        options.signal.removeEventListener('abort', externalSignalHandler);
      }
    }
  }

  private handleHttpError(
    status: number,
    errorBody: unknown,
    model: string,
  ): never {
    const rawErrorBody =
      typeof errorBody === 'string'
        ? errorBody
        : typeof errorBody === 'object' && errorBody !== null
          ? JSON.stringify(errorBody)
          : String(errorBody ?? '');

    // Sanitize and bound the error message to avoid exposing raw HTML or huge bodies
    let sanitized = rawErrorBody.trim();
    if (
      sanitized.startsWith('<') ||
      sanitized.toLowerCase().includes('<!doctype') ||
      sanitized.toLowerCase().includes('<html')
    ) {
      sanitized = 'Upstream returned non-JSON error response';
    } else {
      try {
        const parsed: unknown = JSON.parse(sanitized);
        if (parsed && typeof parsed === 'object') {
          const rec = parsed as Record<string, unknown>;
          const candidate = rec.error ?? rec.message;
          if (typeof candidate === 'string') {
            sanitized = candidate;
          } else if (candidate !== undefined && candidate !== null) {
            sanitized = JSON.stringify(candidate);
          } else {
            sanitized = JSON.stringify(parsed);
          }
        }
      } catch {
        // Not JSON, keep text
      }
    }

    if (typeof sanitized !== 'string') {
      sanitized = String(sanitized);
    }

    // Bound length to at most 200 characters and strip internal control characters
    if (sanitized.length > 200) {
      sanitized = `${sanitized.substring(0, 197)}...`;
    }
    sanitized = sanitized.replace(/[\r\n\t]+/g, ' ').trim();

    const lowerBody = (rawErrorBody + ' ' + sanitized).toLowerCase();

    // 1. Missing model error: 404 with indication of model not found
    if (
      status === 404 &&
      ((lowerBody.includes('model') && lowerBody.includes('not found')) ||
        lowerBody.includes('try pulling it first') ||
        lowerBody.includes(`model '${model.toLowerCase()}'`) ||
        lowerBody.includes(`model "${model.toLowerCase()}"`))
    ) {
      throw ApiException.llmProviderError(
        `Model "${model}" is not downloaded in Ollama. Run: ollama pull ${model}`,
      );
    }

    // 2. Generic 404: wrong endpoint or configuration error
    if (status === 404) {
      throw ApiException.llmProviderError(
        'Ollama endpoint not found (404). Verify OLLAMA_BASE_URL configuration.',
      );
    }

    // 3. Unsupported capability: 400 with explicit indication of tools or options
    if (
      status === 400 &&
      (lowerBody.includes('does not support tools') ||
        lowerBody.includes('unsupported') ||
        lowerBody.includes('tool calls') ||
        lowerBody.includes('tools are not supported'))
    ) {
      throw ApiException.llmProviderError(
        `Unsupported model capability or option in Ollama: ${sanitized}`,
      );
    }

    // 4. Other 400: request error
    if (status === 400) {
      throw ApiException.llmProviderError(
        `Invalid request sent to Ollama (400): ${sanitized}`,
      );
    }

    // 5. Upstream provider failure (500, 502, 503, etc.)
    throw ApiException.llmProviderError(
      `Ollama returned error (${status}): ${sanitized}`,
    );
  }

  private translateHistoryToOllama(
    systemPrompt: string,
    history: LlmConversationMessage[],
  ): OllamaChatMessage[] {
    const messages: OllamaChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    for (const msg of history) {
      if (msg.role === 'tool') {
        const toolMsg: OllamaChatMessage = {
          role: 'tool',
          content: msg.content ?? '',
        };
        if (msg.name) {
          toolMsg.tool_name = msg.name;
        }
        messages.push(toolMsg);
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: msg.content ?? '',
            tool_calls: msg.tool_calls.map((tc) => {
              if (
                !tc.function ||
                typeof tc.function.name !== 'string' ||
                tc.function.name.trim().length === 0
              ) {
                throw ApiException.llmInvalidResponse(
                  'Tool call in conversation history is missing a valid function name.',
                );
              }

              let parsedArgs: Record<string, unknown>;
              if (typeof tc.function.arguments === 'string') {
                try {
                  const parsed: unknown = JSON.parse(tc.function.arguments);
                  if (
                    typeof parsed !== 'object' ||
                    parsed === null ||
                    Array.isArray(parsed)
                  ) {
                    throw new Error('Parsed tool arguments must be a non-null, non-array JSON object.');
                  }
                  parsedArgs = parsed as Record<string, unknown>;
                } catch (parseErr: unknown) {
                  const errMsg =
                    parseErr instanceof Error ? parseErr.message : String(parseErr);
                  throw ApiException.llmInvalidResponse(
                    `Malformed JSON in tool call arguments for "${tc.function.name}": ${errMsg}`,
                  );
                }
              } else if (
                typeof tc.function.arguments === 'object' &&
                tc.function.arguments !== null &&
                !Array.isArray(tc.function.arguments)
              ) {
                parsedArgs = tc.function.arguments;
              } else {
                throw ApiException.llmInvalidResponse(
                  `Malformed arguments for tool call "${tc.function.name}". Expected JSON object or string, received ${typeof tc.function.arguments}.`,
                );
              }

              return {
                id: tc.id,
                function: {
                  name: tc.function.name,
                  arguments: parsedArgs,
                },
              };
            }),
          });
        } else {
          messages.push({
            role: 'assistant',
            content: msg.content ?? '',
          });
        }
      } else {
        messages.push({
          role: msg.role,
          content: msg.content ?? '',
        });
      }
    }

    return messages;
  }
}
