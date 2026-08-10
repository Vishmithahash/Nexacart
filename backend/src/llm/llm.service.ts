import { Inject, Injectable } from '@nestjs/common';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import type {
  LlmProvider,
  LlmProviderTurnOptions,
} from './interfaces/llm-provider.interface';
import { LlmTurnResult } from './types/llm-turn-result.type';

@Injectable()
export class LlmService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
  ) {}

  get providerName(): string {
    return this.provider.providerName;
  }

  async generateTurn(options: LlmProviderTurnOptions): Promise<LlmTurnResult> {
    return this.provider.generateTurn(options);
  }
}
