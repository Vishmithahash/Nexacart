/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProductStatus } from '../generated/prisma/client';
import { Decimal } from '@prisma/client/runtime/client';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: any;
  let auditService: any;

  const mockProduct = {
    id: 1,
    categoryId: 1,
    sku: 'ELEC-WH-001',
    name: 'Wireless Headphones',
    slug: 'wireless-headphones',
    description: 'Noise cancelling',
    price: new Decimal('89.99'),
    currencyCode: 'LKR',
    stockQuantity: 100,
    reservedQuantity: 0,
    lowStockThreshold: 5,
    version: 1,
    status: ProductStatus.DRAFT,
    imageUrls: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    category: {
      id: 1,
      name: 'Electronics',
      slug: 'electronics',
      isActive: true,
    },
  };

  const mockPrismaService = {
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockAuditService = {
    logInTransaction: jest.fn(),
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prisma = module.get(PrismaService);
    auditService = module.get(AuditService);
    jest.clearAllMocks();
  });

  describe('createProduct', () => {
    it('should create a product and create initial stock movement if initialStock > 0', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 1, isActive: true });
      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.findFirst.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 50,
      });

      const dto = {
        categoryId: 1,
        sku: 'elec-wh-001',
        name: 'Wireless Headphones',
        price: '89.99',
        initialStock: 50,
      };

      const result = await service.createProduct(dto, 1);

      expect(result.sku).toBe('ELEC-WH-001'); // SKU normalized to uppercase
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'INITIAL_STOCK',
            quantity: 50,
          }),
        }),
      );
      expect(auditService.logInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PRODUCT_CREATED' }),
        expect.anything(),
      );
    });

    it('should prevent creating ACTIVE product under inactive category', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 1, isActive: false });

      const dto = {
        categoryId: 1,
        sku: 'ELEC-WH-001',
        name: 'Wireless Headphones',
        price: '89.99',
        status: 'ACTIVE' as const,
      };

      await expect(service.createProduct(dto, 1)).rejects.toMatchObject({
        errorCode: 'PRODUCT_CATEGORY_INACTIVE',
      });
    });
  });

  describe('updateProduct', () => {
    it('should update product and increment version on expectedVersion match', async () => {
      prisma.product.findUnique.mockResolvedValue(mockProduct);
      prisma.product.updateMany.mockResolvedValue({ count: 1 });
      prisma.product.findUniqueOrThrow.mockResolvedValue({
        ...mockProduct,
        name: 'Updated Name',
        version: 2,
      });

      const dto = { expectedVersion: 1, name: 'Updated Name' };
      const result = await service.updateProduct(1, dto, 1);

      expect(result.name).toBe('Updated Name');
      expect(result.version).toBe(2);
    });

    it('should throw version conflict error on stale expectedVersion', async () => {
      prisma.product.findUnique.mockResolvedValue(mockProduct);
      prisma.product.updateMany.mockResolvedValue({ count: 0 }); // version mismatch

      const dto = { expectedVersion: 1, name: 'Stale Edit' };
      await expect(service.updateProduct(1, dto, 1)).rejects.toMatchObject({
        errorCode: 'PRODUCT_VERSION_CONFLICT',
      });
    });
  });

  describe('updateProductStatus', () => {
    it('should block deactivating product with reserved stock', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        status: ProductStatus.ACTIVE,
        reservedQuantity: 5,
      });

      const dto = { expectedVersion: 1, status: 'INACTIVE' as const };

      await expect(
        service.updateProductStatus(1, dto, 1),
      ).rejects.toMatchObject({
        errorCode: 'PRODUCT_HAS_RESERVED_STOCK',
      });
    });
  });
});
