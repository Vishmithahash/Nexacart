/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: any;
  let auditService: any;

  const mockCategory = {
    id: 1,
    name: 'Electronics',
    slug: 'electronics',
    description: 'Electronic devices',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { products: 5 },
  };

  const mockPrismaService = {
    category: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    product: {
      count: jest.fn(),
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
        CategoriesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    prisma = module.get(PrismaService);
    auditService = module.get(AuditService);
    jest.clearAllMocks();
  });

  describe('listCategories', () => {
    it('should list all categories for admin', async () => {
      prisma.category.findMany.mockResolvedValue([mockCategory]);
      prisma.category.count.mockResolvedValue(1);
      prisma.product.count.mockResolvedValue(3);

      const result = await service.listCategories({
        page: 1,
        limit: 20,
        sort: 'name_asc',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].productCount).toBe(5);
      expect(result.data[0].activeProductCount).toBe(3);
    });
  });

  describe('createCategory', () => {
    it('should create category and log audit record', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.findUnique.mockResolvedValue(null);
      prisma.category.create.mockResolvedValue(mockCategory);

      const dto = { name: 'Electronics', description: 'Gadgets' };
      const result = await service.createCategory(dto, 1);

      expect(result.name).toBe('Electronics');
      expect(result.slug).toBe('electronics');
      expect(auditService.logInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CATEGORY_CREATED',
          entityType: 'Category',
        }),
        expect.anything(),
      );
    });

    it('should throw conflict if category name exists', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 2 });

      await expect(
        service.createCategory({ name: 'Electronics' }, 1),
      ).rejects.toMatchObject({
        errorCode: 'CATEGORY_NAME_EXISTS',
      });
    });

    it('should throw conflict if category slug exists', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.findUnique.mockResolvedValue({ id: 2 });

      await expect(
        service.createCategory({ name: 'Electronics', slug: 'electronics' }, 1),
      ).rejects.toMatchObject({
        errorCode: 'CATEGORY_SLUG_EXISTS',
      });
    });
  });

  describe('updateCategoryStatus', () => {
    it('should prevent deactivating category if active products exist', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory); // isActive: true
      prisma.product.count.mockResolvedValue(2); // 2 active products

      await expect(
        service.updateCategoryStatus(1, { isActive: false }, 1),
      ).rejects.toMatchObject({
        errorCode: 'CATEGORY_HAS_ACTIVE_PRODUCTS',
      });
    });

    it('should allow deactivating category when no active products exist', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.update.mockResolvedValue({
        ...mockCategory,
        isActive: false,
      });

      const result = await service.updateCategoryStatus(
        1,
        { isActive: false },
        1,
      );

      expect(result.isActive).toBe(false);
      expect(auditService.logInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CATEGORY_DEACTIVATED' }),
        expect.anything(),
      );
    });

    it('should be idempotent when requested status matches current status', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory); // isActive: true
      prisma.product.count.mockResolvedValue(5);

      const result = await service.updateCategoryStatus(
        1,
        { isActive: true },
        1,
      );

      expect(result.isActive).toBe(true);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });
  });
});
