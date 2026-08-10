/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContextService } from '../common/request-context/request-context.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: any;

  const mockProduct = {
    id: 1,
    sku: 'ELEC-WH-001',
    stockQuantity: 100,
    reservedQuantity: 10,
    lowStockThreshold: 5,
    version: 1,
    status: 'ACTIVE',
  };

  const mockMovement = {
    id: 10,
    productId: 1,
    actorUserId: 1,
    type: 'ADJUSTMENT_IN',
    quantity: 20,
    stockBefore: 100,
    stockAfter: 120,
    reservedBefore: 10,
    reservedAfter: 10,
    reason: 'Stock replenishment',
    idempotencyKey: 'key-12345678',
    requestId: 'req-1',
    qaRunId: 'qa-1',
    toolCallId: 'tool-1',
    metadata: {},
    createdAt: new Date(),
  };

  const mockPrismaService = {
    inventoryMovement: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockAuditService = {
    logInTransaction: jest.fn(),
    log: jest.fn(),
  };

  const mockRequestContextService = {
    get: jest.fn().mockReturnValue({
      requestId: 'req-1',
      qaRunId: 'qa-1',
      toolCallId: 'tool-1',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: RequestContextService, useValue: mockRequestContextService },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('adjustInventory', () => {
    it('should adjust stock in and record movement ledger with correlation IDs', async () => {
      prisma.inventoryMovement.findUnique.mockResolvedValue(null); // not replayed
      prisma.product.findUnique.mockResolvedValue(mockProduct);
      prisma.product.update.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 120,
        version: 2,
      });
      prisma.inventoryMovement.create.mockResolvedValue(mockMovement);

      const dto = {
        type: 'ADJUSTMENT_IN' as const,
        quantity: 20,
        reason: 'Stock replenishment',
        expectedVersion: 1,
        idempotencyKey: 'key-12345678',
      };

      const { result, statusCode } = await service.adjustInventory(1, dto, 1);

      expect(statusCode).toBe(201);
      expect(result.replayed).toBe(false);
      expect(result.product.stockQuantity).toBe(120);
      expect(result.product.availableQuantity).toBe(110); // 120 - 10 reserved
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requestId: 'req-1',
            qaRunId: 'qa-1',
            toolCallId: 'tool-1',
          }),
        }),
      );
    });

    it('should return 200 replayed when same idempotency key and params are provided', async () => {
      prisma.inventoryMovement.findUnique.mockResolvedValue(mockMovement);
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 120,
        version: 2,
      });

      const dto = {
        type: 'ADJUSTMENT_IN' as const,
        quantity: 20,
        reason: 'Stock replenishment',
        expectedVersion: 1,
        idempotencyKey: 'key-12345678',
      };

      const { result, statusCode } = await service.adjustInventory(1, dto, 1);

      expect(statusCode).toBe(200);
      expect(result.replayed).toBe(true);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('should throw 409 when idempotency key is reused with different parameters', async () => {
      prisma.inventoryMovement.findUnique.mockResolvedValue(mockMovement);

      const dto = {
        type: 'ADJUSTMENT_IN' as const,
        quantity: 50, // different quantity!
        reason: 'Conflict test',
        expectedVersion: 1,
        idempotencyKey: 'key-12345678',
      };

      await expect(service.adjustInventory(1, dto, 1)).rejects.toMatchObject({
        errorCode: 'INVENTORY_IDEMPOTENCY_CONFLICT',
      });
    });

    it('should throw INVENTORY_INSUFFICIENT_STOCK if stock would go below 0', async () => {
      prisma.inventoryMovement.findUnique.mockResolvedValue(null);
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 10,
        reservedQuantity: 0,
      });

      const dto = {
        type: 'ADJUSTMENT_OUT' as const,
        quantity: 20, // 10 - 20 = -10
        reason: 'Damaged stock',
        expectedVersion: 1,
        idempotencyKey: 'key-out-of-stock',
      };

      await expect(service.adjustInventory(1, dto, 1)).rejects.toMatchObject({
        errorCode: 'INVENTORY_INSUFFICIENT_STOCK',
      });
    });

    it('should throw INVENTORY_ADJUSTMENT_INVALID if stock would fall below reservedQuantity', async () => {
      prisma.inventoryMovement.findUnique.mockResolvedValue(null);
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 10,
        reservedQuantity: 8,
      });

      const dto = {
        type: 'ADJUSTMENT_OUT' as const,
        quantity: 5, // 10 - 5 = 5 < 8 reserved!
        reason: 'Adjustment below reserved',
        expectedVersion: 1,
        idempotencyKey: 'key-below-reserved',
      };

      await expect(service.adjustInventory(1, dto, 1)).rejects.toMatchObject({
        errorCode: 'INVENTORY_ADJUSTMENT_INVALID',
      });
    });

    it('should throw PRODUCT_VERSION_CONFLICT if expectedVersion does not match current version', async () => {
      prisma.inventoryMovement.findUnique.mockResolvedValue(null);
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        version: 5, // current version is 5
      });

      const dto = {
        type: 'ADJUSTMENT_IN' as const,
        quantity: 10,
        reason: 'Stale version',
        expectedVersion: 1, // expected version is 1
        idempotencyKey: 'key-stale-version',
      };

      await expect(service.adjustInventory(1, dto, 1)).rejects.toMatchObject({
        errorCode: 'PRODUCT_VERSION_CONFLICT',
      });
    });
  });
});
