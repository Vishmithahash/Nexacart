import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ApiException } from '../common/exceptions/api.exception';
import { InventoryMovementType } from '../generated/prisma/client';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryMovementsQueryDto } from './dto/inventory-movements-query.dto';

const MAX_RETRIES = 3;

// Postgres serialization error codes
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';

export interface MovementRecord {
  id: number;
  type: InventoryMovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  reason: string | null;
  idempotencyKey: string | null;
  requestId: string | null;
  qaRunId: string | null;
  toolCallId: string | null;
  createdAt: Date;
}

export interface AdjustmentResult {
  replayed: boolean;
  product: {
    id: number;
    sku: string;
    stockQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
    version: number;
  };
  movement: MovementRecord;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
  ) {}

  // ── Adjust inventory ──────────────────────────────────────────────────────

  async adjustInventory(
    productId: number,
    dto: AdjustInventoryDto,
    actorUserId: number,
  ): Promise<{ result: AdjustmentResult; statusCode: number }> {
    // ── Idempotency check (outside transaction — fast path) ───────────────
    const existing = await this.prisma.inventoryMovement.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });

    if (existing) {
      // Key already used — check if parameters match
      const sameProduct = existing.productId === productId;
      const sameType = existing.type === (dto.type as InventoryMovementType);
      const sameQty = existing.quantity === dto.quantity;

      if (!sameProduct || !sameType || !sameQty) {
        // Conflict: same key, different parameters
        await this.auditService.log({
          userId: actorUserId,
          action: 'INVENTORY_ADJUSTMENT_FAILED',
          entityType: 'Product',
          entityId: String(productId),
          success: false,
          errorCode: 'INVENTORY_IDEMPOTENCY_CONFLICT',
          metadata: {
            idempotencyKey: dto.idempotencyKey,
            existingMovementId: existing.id,
          },
        });
        throw ApiException.inventoryIdempotencyConflict();
      }

      // Replay: same key, same parameters
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          sku: true,
          stockQuantity: true,
          reservedQuantity: true,
          version: true,
        },
      });

      if (!product) throw ApiException.productNotFound();

      await this.auditService.log({
        userId: actorUserId,
        action: 'INVENTORY_ADJUSTMENT_REPLAYED',
        entityType: 'Product',
        entityId: String(productId),
        success: true,
        metadata: {
          idempotencyKey: dto.idempotencyKey,
          movementId: existing.id,
          replayed: true,
        },
      });

      return {
        statusCode: 200,
        result: {
          replayed: true,
          product: {
            id: product.id,
            sku: product.sku,
            stockQuantity: product.stockQuantity,
            reservedQuantity: product.reservedQuantity,
            availableQuantity: product.stockQuantity - product.reservedQuantity,
            version: product.version,
          },
          movement: this.mapMovement(existing),
        },
      };
    }

    // ── Apply adjustment with serializable transaction + retry ─────────────
    const ctx = this.requestContext.get();
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            // Lock the product row (SELECT FOR UPDATE via findUnique in serializable)
            const product = await tx.product.findUnique({
              where: { id: productId },
              select: {
                id: true,
                sku: true,
                stockQuantity: true,
                reservedQuantity: true,
                lowStockThreshold: true,
                version: true,
                status: true,
              },
            });

            if (!product) throw ApiException.productNotFound();

            // Version check
            if (product.version !== dto.expectedVersion) {
              throw ApiException.productVersionConflict();
            }

            const stockBefore = product.stockQuantity;
            const reservedBefore = product.reservedQuantity;
            const isIn = dto.type === 'ADJUSTMENT_IN';

            let stockAfter: number;
            if (isIn) {
              stockAfter = stockBefore + dto.quantity;
            } else {
              stockAfter = stockBefore - dto.quantity;
            }

            // Guard: cannot go below 0
            if (stockAfter < 0) {
              throw ApiException.inventoryInsufficientStock();
            }

            // Guard: cannot go below reservedQuantity
            if (stockAfter < reservedBefore) {
              throw ApiException.inventoryAdjustmentInvalid(
                `Cannot reduce stock below reserved quantity (${reservedBefore}).`,
              );
            }

            // Update product stock and version atomically
            const updatedProduct = await tx.product.update({
              where: { id: productId, version: dto.expectedVersion },
              data: {
                stockQuantity: stockAfter,
                version: { increment: 1 },
              },
              select: {
                id: true,
                sku: true,
                stockQuantity: true,
                reservedQuantity: true,
                version: true,
              },
            });

            // Create immutable movement record
            const movement = await tx.inventoryMovement.create({
              data: {
                productId,
                actorUserId,
                type: dto.type,
                quantity: dto.quantity,
                stockBefore,
                stockAfter,
                reservedBefore,
                reservedAfter: reservedBefore, // Phase 3 never changes reservedQuantity
                reason: dto.reason,
                idempotencyKey: dto.idempotencyKey,
                requestId: ctx?.requestId ?? null,
                qaRunId: ctx?.qaRunId ?? null,
                toolCallId: ctx?.toolCallId ?? null,
                metadata: { adjustmentType: dto.type },
              },
            });

            const auditAction = isIn
              ? 'INVENTORY_ADJUSTED_IN'
              : 'INVENTORY_ADJUSTED_OUT';

            await this.auditService.logInTransaction(
              {
                userId: actorUserId,
                action: auditAction,
                entityType: 'Product',
                entityId: String(productId),
                success: true,
                metadata: {
                  sku: product.sku,
                  movementId: movement.id,
                  type: dto.type,
                  quantity: dto.quantity,
                  stockBefore,
                  stockAfter,
                  idempotencyKey: dto.idempotencyKey,
                  replayed: false,
                },
              },
              tx,
            );

            return {
              updatedProduct,
              movement,
            };
          },
          { isolationLevel: 'Serializable' },
        );

        return {
          statusCode: 201,
          result: {
            replayed: false,
            product: {
              id: result.updatedProduct.id,
              sku: result.updatedProduct.sku,
              stockQuantity: result.updatedProduct.stockQuantity,
              reservedQuantity: result.updatedProduct.reservedQuantity,
              availableQuantity:
                result.updatedProduct.stockQuantity -
                result.updatedProduct.reservedQuantity,
              version: result.updatedProduct.version,
            },
            movement: this.mapMovement(result.movement),
          },
        };
      } catch (err: unknown) {
        // Only retry serialization/deadlock errors — not business logic errors
        if (this.isSerializationError(err) && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `Serialization conflict on inventory adjustment, attempt ${attempt + 1}/${MAX_RETRIES}`,
          );
          lastError = err;
          continue;
        }
        // Rethrow business logic errors and final-attempt errors immediately
        throw err;
      }
    }

    // All retries exhausted
    this.logger.error(
      'All retry attempts failed for inventory adjustment',
      lastError,
    );
    throw lastError;
  }

  // ── Movement history ──────────────────────────────────────────────────────

  async getMovements(
    productId: number,
    query: InventoryMovementsQueryDto,
  ): Promise<{
    data: MovementRecord[];
    pagination: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }> {
    // Verify product exists
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw ApiException.productNotFound();

    const {
      page,
      limit,
      type,
      dateFrom,
      dateTo,
      requestId,
      qaRunId,
      toolCallId,
    } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { productId };

    if (type) where['type'] = type;
    if (requestId) where['requestId'] = requestId;
    if (qaRunId) where['qaRunId'] = qaRunId;
    if (toolCallId) where['toolCallId'] = toolCallId;

    if (dateFrom || dateTo) {
      where['createdAt'] = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [movements, totalItems] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      data: movements.map((m) => this.mapMovement(m)),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private mapMovement(m: {
    id: number;
    type: InventoryMovementType;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    reservedBefore: number;
    reservedAfter: number;
    reason: string | null;
    idempotencyKey: string | null;
    requestId: string | null;
    qaRunId: string | null;
    toolCallId: string | null;
    createdAt: Date;
  }): MovementRecord {
    return {
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      stockBefore: m.stockBefore,
      stockAfter: m.stockAfter,
      reservedBefore: m.reservedBefore,
      reservedAfter: m.reservedAfter,
      reason: m.reason,
      idempotencyKey: m.idempotencyKey,
      requestId: m.requestId,
      qaRunId: m.qaRunId,
      toolCallId: m.toolCallId,
      createdAt: m.createdAt,
    };
  }

  private isSerializationError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as Record<string, unknown>;
    // Prisma wraps PostgreSQL errors; check the code field
    const code = e['code'] as string | undefined;
    return code === PG_SERIALIZATION_FAILURE || code === PG_DEADLOCK_DETECTED;
  }
}
