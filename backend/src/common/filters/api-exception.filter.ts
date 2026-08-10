import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiException } from '../exceptions/api.exception';
import { RequestContextService } from '../request-context/request-context.service';

// Prisma error codes we handle explicitly
const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_RECORD_NOT_FOUND = 'P2025';
const PRISMA_FK_CONSTRAINT = 'P2003';

interface ErrorResponse {
  statusCode: number;
  errorCode: string;
  message: string;
  path: string;
  requestId: string;
  timestamp: string;
}

@Injectable()
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  constructor(private readonly requestContextService: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = this.requestContextService.getRequestId() ?? 'unknown';
    const path = request.url;
    const timestamp = new Date().toISOString();

    const { statusCode, errorCode, message } = this.resolveError(exception);

    // Log safely — no stack traces in production, no sensitive data
    this.logger.warn(
      `[${requestId}] ${statusCode} ${errorCode} — ${path} — ${message}`,
    );

    const body: ErrorResponse = {
      statusCode,
      errorCode,
      message,
      path,
      requestId,
      timestamp,
    };

    response.status(statusCode).json(body);
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    errorCode: string;
    message: string;
  } {
    // Our own structured exceptions — extract errorCode from response body
    if (exception instanceof ApiException) {
      const body = exception.getResponse() as {
        errorCode: string;
        message: string;
      };
      return {
        statusCode: exception.getStatus(),
        errorCode: body.errorCode ?? 'API_ERROR',
        message: body.message ?? 'An error occurred.',
      };
    }

    // NestJS HttpException (validation errors, etc.)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;

        // ValidationPipe errors
        if (Array.isArray(b['message'])) {
          return {
            statusCode: status,
            errorCode: 'VALIDATION_ERROR',
            message: (b['message'] as string[]).join('; '),
          };
        }

        if (typeof b['message'] === 'string') {
          return {
            statusCode: status,
            errorCode: (b['errorCode'] as string) ?? this.statusToCode(status),
            message: b['message'],
          };
        }
      }

      return {
        statusCode: status,
        errorCode: this.statusToCode(status),
        message: exception.message,
      };
    }

    // Prisma known request errors — map safely
    if (this.isPrismaError(exception)) {
      return this.mapPrismaError(exception as PrismaError);
    }

    // Unknown errors — log full details server-side only
    this.logger.error('Unhandled exception', exception);
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    };
  }

  private isPrismaError(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      typeof (e as Record<string, unknown>)['code'] === 'string' &&
      ((e as Record<string, unknown>)['code'] as string).startsWith('P')
    );
  }

  private mapPrismaError(e: PrismaError): {
    statusCode: number;
    errorCode: string;
    message: string;
  } {
    switch (e.code) {
      case PRISMA_UNIQUE_VIOLATION:
        return {
          statusCode: HttpStatus.CONFLICT,
          errorCode: 'RESOURCE_CONFLICT',
          message: 'A record with this value already exists.',
        };
      case PRISMA_RECORD_NOT_FOUND:
        return {
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'The requested record was not found.',
        };
      case PRISMA_FK_CONSTRAINT:
        return {
          statusCode: HttpStatus.CONFLICT,
          errorCode: 'RESOURCE_CONFLICT',
          message: 'Operation violates a referential constraint.',
        };
      default:
        this.logger.error(`Unhandled Prisma error: ${e.code}`);
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'A database error occurred.',
        };
    }
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'AUTH_TOKEN_INVALID',
      403: 'AUTH_FORBIDDEN',
      404: 'RESOURCE_NOT_FOUND',
      409: 'RESOURCE_CONFLICT',
      422: 'VALIDATION_ERROR',
    };
    return map[status] ?? 'INTERNAL_SERVER_ERROR';
  }
}

interface PrismaError {
  code: string;
  message: string;
}
