import { ConfigService } from '@nestjs/config';
import { OllamaLlmProvider } from './ollama-llm.provider';
import { ApiException } from '../../common/exceptions/api.exception';

describe('OllamaLlmProvider', () => {
  let provider: OllamaLlmProvider;
  let configService: ConfigService;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    const configMap: Record<string, any> = {
      OLLAMA_BASE_URL: 'http://localhost:11434/',
      OLLAMA_MODEL: 'qwen3.5:4b',
      OLLAMA_REQUEST_TIMEOUT_MS: 5000,
      OLLAMA_NUM_CTX: 8192,
    };

    configService = {
      get: jest.fn((key: string, defaultVal?: any) => configMap[key] ?? defaultVal),
    } as unknown as ConfigService;

    provider = new OllamaLlmProvider(configService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('Provider metadata & configuration', () => {
    it('reports providerName as OLLAMA', () => {
      expect(provider.providerName).toBe('OLLAMA');
    });

    it('works in Ollama mode without any OpenAI or hosted API keys configured', () => {
      expect((configService.get as jest.Mock)('OPENAI_API_KEY')).toBeUndefined();
      expect(provider.providerName).toBe('OLLAMA');
    });

    it('handles trailing slashes in OLLAMA_BASE_URL correctly', async () => {
      let requestedUrl = '';
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: { role: 'assistant', content: 'Clean URL response' },
          }),
          { status: 200 },
        );
      });

      const result = await provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'You are an assistant',
        tools: [],
        conversationHistory: [{ role: 'user', content: 'Hello' }],
      });

      expect(requestedUrl).toBe('http://localhost:11434/api/chat');
      expect(result.type).toBe('text');
      expect(result.content).toBe('Clean URL response');
    });
  });

  describe('Native request and history translation', () => {
    it('translates system prompt, user history, assistant tool-calls, and tool results correctly', async () => {
      let sentPayload: any;
      global.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentPayload = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: { role: 'assistant', content: 'Final response after tool result' },
          }),
          { status: 200 },
        );
      });

      await provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'System instructions here',
        tools: [
          {
            name: 'search_products',
            description: 'Search catalog',
            parameters: { type: 'object', properties: { q: { type: 'string' } } },
          },
        ],
        conversationHistory: [
          { role: 'user', content: 'Find shoes' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'search_products',
                  arguments: JSON.stringify({ q: 'shoes' }),
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_123',
            name: 'search_products',
            content: JSON.stringify({ ok: true, data: { items: ['sneakers'] } }),
          },
        ],
      });

      expect(sentPayload.model).toBe('qwen3.5:4b');
      expect(sentPayload.stream).toBe(false);
      expect(sentPayload.options.num_ctx).toBe(8192);

      // Check messages translation
      expect(sentPayload.messages[0]).toEqual({
        role: 'system',
        content: 'System instructions here',
      });
      expect(sentPayload.messages[1]).toEqual({
        role: 'user',
        content: 'Find shoes',
      });
      expect(sentPayload.messages[2].role).toBe('assistant');
      expect(sentPayload.messages[2].tool_calls[0].function).toEqual({
        name: 'search_products',
        arguments: { q: 'shoes' },
      });
      expect(sentPayload.messages[3]).toEqual({
        role: 'tool',
        tool_name: 'search_products',
        content: JSON.stringify({ ok: true, data: { items: ['sneakers'] } }),
      });

      // Check tool definition translation
      expect(sentPayload.tools).toHaveLength(1);
      expect(sentPayload.tools[0]).toEqual({
        type: 'function',
        function: {
          name: 'search_products',
          description: 'Search catalog',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      });
    });
  });

  describe('Responses and structured tool calls', () => {
    it('returns text response with stripped thinking tags and maps usage metrics', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 120,
            eval_count: 45,
            message: {
              role: 'assistant',
              content: '<think>I should formulate a polite greeting</think>Hello! How can I help you today?',
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'System',
        tools: [],
        conversationHistory: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.type).toBe('text');
      expect(result.content).toBe('Hello! How can I help you today?');
      expect(result.usage).toEqual({
        promptTokens: 120,
        completionTokens: 45,
        totalTokens: 165,
      });
    });

    it('returns structured tool calls with parsed arguments and generates call ID if omitted by Ollama', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  function: {
                    name: 'get_product_detail',
                    arguments: { productId: 42 },
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'System',
        tools: [],
        conversationHistory: [{ role: 'user', content: 'Check product 42' }],
      });

      expect(result.type).toBe('tool_call');
      expect(result.toolCall).toBeDefined();
      expect(result.toolCall?.name).toBe('get_product_detail');
      expect(result.toolCall?.arguments).toEqual({ productId: 42 });
      expect(result.toolCall?.providerCallId).toMatch(/^call_ollama_/);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls?.[0].providerCallId).toBe(result.toolCall?.providerCallId);
    });

    it('returns multiple structured tool calls in sequential model order', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_alpha',
                  function: {
                    name: 'search_products',
                    arguments: { q: 'headphones' },
                  },
                },
                {
                  id: 'call_beta',
                  function: {
                    name: 'get_cart',
                    arguments: {},
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'System',
        tools: [],
        conversationHistory: [{ role: 'user', content: 'Search and check cart' }],
      });

      expect(result.type).toBe('tool_call');
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls?.[0].name).toBe('search_products');
      expect(result.toolCalls?.[0].providerCallId).toBe('call_alpha');
      expect(result.toolCalls?.[1].name).toBe('get_cart');
      expect(result.toolCalls?.[1].providerCallId).toBe('call_beta');
      expect(result.toolCall?.providerCallId).toBe('call_alpha');
    });
  });

  describe('Error handling & sanitization', () => {
    it('throws sanitized error when Ollama server is unreachable', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

      await expect(
        provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(ApiException);

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).toContain('Ollama server unreachable');
      }
    });

    it('throws clear error when model is not downloaded in Ollama (404)', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "model 'qwen3.5:4b' not found, try pulling it first" }),
          { status: 404 },
        ),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).toContain('Run: ollama pull qwen3.5:4b');
      }
    });

    it('throws error on unsupported model capabilities (400)', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'model does not support tools' }),
          { status: 400 },
        ),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).toContain('Unsupported model capability');
      }
    });

    it('throws error when Ollama request times out', async () => {
      jest.useFakeTimers();

      global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const promise = provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'System',
        tools: [],
        conversationHistory: [{ role: 'user', content: 'Hi' }],
        timeoutMs: 1000,
      });

      jest.advanceTimersByTime(1500);

      await expect(promise).rejects.toThrow(ApiException);
      try {
        await promise;
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).toContain('timed out');
      } finally {
        jest.useRealTimers();
      }
    });

    it('throws invalid response on malformed JSON response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('<html>Bad Gateway</html>', { status: 200 }),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_INVALID_RESPONSE');
      }
    });

    it('throws error when generation is truncated (done_reason=length)', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'length',
            message: { role: 'assistant', content: 'Incomplete text...' },
          }),
          { status: 200 },
        ),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).toContain('truncated or incomplete');
      }
    });

    it('throws error on empty final output without tool calls (only think tags)', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '<think>Reasoning only, no final message</think>',
            },
          }),
          { status: 200 },
        ),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_INVALID_RESPONSE');
        expect(err.message).toContain('empty final text content');
      }
    });

    it('throws error on malformed tool call arguments without silently replacing with {}', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_bad',
                  function: {
                    name: 'search_products',
                    arguments: '{ broken json: }',
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_INVALID_RESPONSE');
        expect(err.message).toContain('Malformed JSON in tool call arguments');
      }
    });

    it('rejects malformed conversation history tool call arguments with LLM_INVALID_RESPONSE', async () => {
      // 1. Array arguments in history
      await expect(
        provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [
            {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_bad',
                  type: 'function',
                  function: {
                    name: 'search_products',
                    arguments: '["array", "not", "object"]',
                  },
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow(ApiException);

      // 2. Null arguments in history
      await expect(
        provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [
            {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_bad2',
                  type: 'function',
                  function: {
                    name: 'search_products',
                    arguments: 'null',
                  },
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow(ApiException);

      // 3. Malformed JSON in history
      await expect(
        provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [
            {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_bad3',
                  type: 'function',
                  function: {
                    name: 'search_products',
                    arguments: '{ not valid json }',
                  },
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow(ApiException);
    });

    it('handles an already-aborted signal without sending a network request', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      await expect(
        provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
          signal: abortController.signal,
        }),
      ).rejects.toThrow(ApiException);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps timeout/cancellation active when headers arrive immediately but body reading stalls until abort', async () => {
      const abortController = new AbortController();

      // Response where text() hangs until aborted
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockImplementation(() => {
          return new Promise((_resolve, reject) => {
            if (abortController.signal.aborted) {
              const err = new Error('Body reading aborted');
              err.name = 'AbortError';
              return reject(err);
            }
            abortController.signal.addEventListener('abort', () => {
              const err = new Error('Body reading aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }),
      } as unknown as Response;

      global.fetch = jest.fn().mockResolvedValue(mockResponse);

      const promise = provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'System',
        tools: [],
        conversationHistory: [{ role: 'user', content: 'Hi' }],
        signal: abortController.signal,
      });

      // Let fetch resolve so body reading text() starts
      await new Promise((r) => setImmediate(r));

      // Headers arrived, now body reading is in progress; trigger external cancellation
      abortController.abort();

      await expect(promise).rejects.toThrow(ApiException);
      try {
        await promise;
      } catch (err: any) {
        expect(err.errorCode).toBe('AGENT_EXECUTION_BUDGET_EXCEEDED');
      }
    });

    it('handles multiline thinking blocks and extracts final customer text', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '<think>\nFirst line of reasoning\nSecond line of reasoning\n</think>\nHere is your product.',
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.generateTurn({
        model: 'qwen3.5:4b',
        systemPrompt: 'System',
        tools: [],
        conversationHistory: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.type).toBe('text');
      expect(result.content).toBe('Here is your product.');
    });

    it('rejects unfinished thinking blocks without exposing them as successful final answer', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '<think>Unfinished thinking without closing tag...',
            },
          }),
          { status: 200 },
        ),
      );

      await expect(
        provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(ApiException);
    });

    it('does not expose message.thinking as final text when content is empty', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: '',
              thinking: 'Internal reasoning only',
            },
          }),
          { status: 200 },
        ),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_INVALID_RESPONSE');
      }
    });

    it('rejects response with missing done flag or done=false', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'Text without done flag' },
          }),
          { status: 200 },
        ),
      );

      await expect(
        provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toThrow(ApiException);
    });

    it('rejects malformed non-array tool_calls structure with LLM_INVALID_RESPONSE', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            done: true,
            done_reason: 'stop',
            message: {
              role: 'assistant',
              content: 'Fallback text',
              tool_calls: { name: 'not_an_array' },
            },
          }),
          { status: 200 },
        ),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_INVALID_RESPONSE');
        expect(err.message).toContain('must be an array');
      }
    });

    it('distinguishes generic 404 endpoint error from missing model error', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('404 page not found', { status: 404 }),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).toContain('Ollama endpoint not found (404)');
      }
    });

    it('distinguishes generic 400 request error from unsupported capabilities and sanitizes HTML', async () => {
      // Generic 400
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid format' }), { status: 400 }),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).toContain('Invalid request sent to Ollama (400)');
      }

      // Upstream 502 with HTML body
      global.fetch = jest.fn().mockResolvedValue(
        new Response('<html><body><h1>502 Bad Gateway</h1><p>proxy failed</p></body></html>', { status: 502 }),
      );

      try {
        await provider.generateTurn({
          model: 'qwen3.5:4b',
          systemPrompt: 'System',
          tools: [],
          conversationHistory: [{ role: 'user', content: 'Hi' }],
        });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.errorCode).toBe('LLM_PROVIDER_ERROR');
        expect(err.message).not.toContain('<html>');
        expect(err.message).toContain('Ollama returned error (502)');
      }
    });
  });
});
