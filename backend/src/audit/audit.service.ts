import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { AuditActorType } from '../generated/prisma/client';

export interface AuditInput {
  userId?: number;
  actorType?: AuditActorType;
  action: string;
  entityType: string;
  entityId: string;
  success: boolean;
  errorCode?: string;
  /** Must never contain passwords, tokens, hashes, or credentials */
  metadata?: Record<string, unknown>;
}

/** Minimal Prisma client interface used by audit writes (works for both service and transaction clients) */
interface AuditPrismaClient {
  auditLog: {
    create: (args: { data: object }) => Promise<unknown>;
  };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * Fire-and-forget audit log write.
   * Errors are swallowed — audit failures never break business operations.
   */
  async log(input: AuditInput): Promise<void> {
    try {
      await this.writeAuditLog(input, this.prisma);
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for action="${input.action}" entity="${input.entityType}:${input.entityId}"`,
      );
    }
  }

  /**
   * Transactional audit log write — must be called inside a Prisma $transaction block.
   * Errors are propagated so they can roll back the enclosing transaction.
   */
  async logInTransaction(
    input: AuditInput,
    tx: AuditPrismaClient,
  ): Promise<void> {
    await this.writeAuditLog(input, tx);
  }

  private async writeAuditLog(
    input: AuditInput,
    client: AuditPrismaClient,
  ): Promise<void> {
    const ctx = this.requestContext.get();

    await client.auditLog.create({
      data: {
        userId: input.userId ?? null,
        actorType: input.actorType ?? AuditActorType.USER,
        action: input.action,
        entityType: input.entityType,
        entityId: String(input.entityId),
        success: input.success,
        errorCode: input.errorCode ?? null,
        requestId: ctx?.requestId ?? null,
        qaRunId: ctx?.qaRunId ?? null,
        toolCallId: ctx?.toolCallId ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        metadata: input.metadata ?? null,
      },
    });
  }
}
