import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmModule } from './llm.module';
import { LLM_PROVIDER, LlmProvider } from './interfaces/llm-provider.interface';
import { OpenAiLlmProvider } from './openai/openai-llm.provider';
import { OllamaLlmProvider } from './ollama/ollama-llm.provider';

describe('LlmModule Provider Selection', () => {
  it('selects OpenAiLlmProvider by default when LLM_PROVIDER is not set', async () => {
    const mockConfig = {
      get: jest.fn((key: string, defaultVal?: unknown): unknown => {
        if (key === 'LLM_PROVIDER') return undefined;
        return defaultVal;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [LlmModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfig)
      .compile();

    const provider = moduleRef.get<LlmProvider>(LLM_PROVIDER);
    expect(provider).toBeInstanceOf(OpenAiLlmProvider);
    expect(provider.providerName).toBe('OPENAI');
  });

  it('selects OllamaLlmProvider when LLM_PROVIDER is set to ollama', async () => {
    const mockConfig = {
      get: jest.fn((key: string, defaultVal?: unknown): unknown => {
        if (key === 'LLM_PROVIDER') return 'ollama';
        if (key === 'OLLAMA_BASE_URL') return 'http://localhost:11434';
        return defaultVal;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [LlmModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfig)
      .compile();

    const provider = moduleRef.get<LlmProvider>(LLM_PROVIDER);
    expect(provider).toBeInstanceOf(OllamaLlmProvider);
    expect(provider.providerName).toBe('OLLAMA');
  });

  it('throws a clear error when an unsupported LLM_PROVIDER is configured', async () => {
    const mockConfig = {
      get: jest.fn((key: string, defaultVal?: unknown): unknown => {
        if (key === 'LLM_PROVIDER') return 'anthropic';
        return defaultVal;
      }),
    };

    await expect(
      Test.createTestingModule({
        imports: [LlmModule],
      })
        .overrideProvider(ConfigService)
        .useValue(mockConfig)
        .compile(),
    ).rejects.toThrow(
      'Unsupported LLM_PROVIDER "anthropic". Supported providers are: "openai", "ollama".',
    );
  });
});
