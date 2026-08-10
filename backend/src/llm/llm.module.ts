import { Module } from '@nestjs/common';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import { OpenAiLlmProvider } from './openai/openai-llm.provider';
import { LlmService } from './llm.service';

@Module({
  providers: [
    OpenAiLlmProvider,
    {
      provide: LLM_PROVIDER,
      useClass: OpenAiLlmProvider,
    },
    LlmService,
  ],
  exports: [LlmService, LLM_PROVIDER],
})
export class LlmModule {}
