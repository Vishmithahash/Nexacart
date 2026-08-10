import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { RequestContextService } from '../request-context/request-context.service';

const MAX_REQUEST_ID_LENGTH = 100;
const MAX_QA_RUN_ID_LENGTH = 100;
const MAX_TOOL_CALL_ID_LENGTH = 100;

function sanitizeHeader(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  // Only allow printable ASCII characters (no control characters)
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return undefined;
  return trimmed;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawRequestId = req.headers['x-request-id'] as string | undefined;
    const requestId =
      sanitizeHeader(rawRequestId, MAX_REQUEST_ID_LENGTH) ?? randomUUID();

    const qaRunId = sanitizeHeader(
      req.headers['x-qa-run-id'] as string | undefined,
      MAX_QA_RUN_ID_LENGTH,
    );

    const toolCallId = sanitizeHeader(
      req.headers['x-tool-call-id'] as string | undefined,
      MAX_TOOL_CALL_ID_LENGTH,
    );

    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ?? req.socket?.remoteAddress;

    const userAgent = req.headers['user-agent'];

    // Always return the request ID — even if client provided an invalid one
    // we return the one we actually used
    res.setHeader('X-Request-ID', requestId);

    this.requestContextService.run(
      {
        requestId,
        qaRunId,
        toolCallId,
        ipAddress: ipAddress ? ipAddress.substring(0, 64) : undefined,
        userAgent: userAgent ? userAgent.substring(0, 500) : undefined,
      },
      () => next(),
    );
  }
}
