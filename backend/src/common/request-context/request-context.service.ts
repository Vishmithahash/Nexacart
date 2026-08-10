import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  qaRunId?: string;
  toolCallId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run(context: RequestContext, callback: () => void): void {
    this.storage.run(context, callback);
  }

  async runWithOverrides<T>(
    overrides: Partial<RequestContext>,
    callback: () => Promise<T>,
  ): Promise<T> {
    const current = this.get() ?? { requestId: 'internal' };
    const nextContext: RequestContext = {
      ...current,
      ...overrides,
    };
    return this.storage.run(nextContext, callback);
  }

  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  getQaRunId(): string | undefined {
    return this.storage.getStore()?.qaRunId;
  }

  getToolCallId(): string | undefined {
    return this.storage.getStore()?.toolCallId;
  }

  getIpAddress(): string | undefined {
    return this.storage.getStore()?.ipAddress;
  }

  getUserAgent(): string | undefined {
    return this.storage.getStore()?.userAgent;
  }
}
