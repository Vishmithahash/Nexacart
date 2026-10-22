import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import { OpenAiLlmProvider } from './openai/openai-llm.provider';
import { OllamaLlmProvider } from './ollama/ollama-llm.provider';
import { LlmService } from './llm.service';

@Module({
  imports: [ConfigModule],
  providers: [
    OpenAiLlmProvider,
    OllamaLlmProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        configService: ConfigService,
        openAiProvider: OpenAiLlmProvider,
        ollamaProvider: OllamaLlmProvider,
      ) => {
        const rawProvider = configService.get<string>('LLM_PROVIDER', 'openai');
        const normalized = (rawProvider || 'openai').trim().toLowerCase();

        if (normalized === 'ollama') {
          return ollamaProvider;
        }

        if (normalized === 'openai') {
          return openAiProvider;
        }

        throw new Error(
          `Unsupported LLM_PROVIDER "${rawProvider}". Supported providers are: "openai", "ollama".`,
        );
      },
      inject: [ConfigService, OpenAiLlmProvider, OllamaLlmProvider],
    },
    LlmService,
  ],
  exports: [LlmService, LLM_PROVIDER, OpenAiLlmProvider, OllamaLlmProvider],
})
export class LlmModule {}
