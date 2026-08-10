/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductStatus } from '../generated/prisma/client';
import { ApiException } from '../common/exceptions/api.exception';
import { Decimal } from '@prisma/client/runtime/client';

describe('CatalogService', () => {
  let service: CatalogService;
  let prisma: any;

  const mockCategory = {
    id: 1,
    name: 'Electronics',
    slug: 'electronics',
    description: 'Electronic devices',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { products: 3 },
  };

  const mockProduct = {
    id: 1,
    sku: 'ELEC-WH-001',
    name: 'Wireless Headphones',
    slug: 'wireless-headphones',
    description: 'Premium headphones',
    price: new Decimal('89.99'),
    currencyCode: 'LKR',
    stockQuantity: 150,
    reservedQuantity: 0,
    lowStockThreshold: 5,
    version: 1,
    status: ProductStatus.ACTIVE,
    imageUrls: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    category: { id: 1, name: 'Electronics', slug: 'electronics' },
  };

  const mockPrismaService = {
    category: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      fields: {},
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  // ── Categories ─────────────────────────────────────────────────────────

  describe('listActiveCategories', () => {
    it('should return only active categories with pagination', async () => {
      prisma.category.findMany.mockResolvedValue([mockCategory]);
      prisma.category.count.mockResolvedValue(1);

      const result = await service.listActiveCategories({ page: 1, limit: 20 });

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].activeProductCount).toBe(3);
      expect(result.pagination.totalItems).toBe(1);
      expect(result.pagination.page).toBe(1);
    });

    it('should return correct pagination metadata', async () => {
      prisma.category.findMany.mockResolvedValue([mockCategory]);
      prisma.category.count.mockResolvedValue(25);

      const result = await service.listActiveCategories({ page: 2, limit: 20 });

      expect(result.pagination.totalPages).toBe(2);
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.hasPreviousPage).toBe(true);
    });
  });

  describe('getActiveCategoryBySlug', () => {
    it('should return active category by slug', async () => {
      prisma.category.findFirst.mockResolvedValue(mockCategory);

      const result = await service.getActiveCategoryBySlug('electronics');

      expect(prisma.category.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'electronics', isActive: true },
        }),
      );
      expect(result.slug).toBe('electronics');
    });

    it('should throw 404 for inactive category', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.getActiveCategoryBySlug('inactive-cat'),
      ).rejects.toThrow(ApiException);
    });

    it('should not disclose inactive categories through public endpoint', async () => {
      prisma.category.findFirst.mockResolvedValue(null); // isActive: false is filtered out in query

      await expect(
        service.getActiveCategoryBySlug('hidden-cat'),
      ).rejects.toMatchObject({
        errorCode: 'CATEGORY_NOT_FOUND',
      });
    });
  });

  // ── Products ────────────────────────────────────────────────────────────

  describe('listActiveProducts', () => {
    it('should filter only ACTIVE products in active categories', async () => {
      prisma.product.findMany.mockResolvedValue([mockProduct]);
      prisma.product.count.mockResolvedValue(1);

      await service.listActiveProducts({ page: 1, limit: 20, sort: 'newest' });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ProductStatus.ACTIVE,
            category: { isActive: true },
          }),
        }),
      );
    });

    it('should return price as a decimal string', async () => {
      prisma.product.findMany.mockResolvedValue([mockProduct]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.listActiveProducts({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      expect(result.data[0].price).toBe('89.99');
      expect(typeof result.data[0].price).toBe('string');
    });

    it('should compute availableQuantity correctly', async () => {
      const productWithReserved = {
        ...mockProduct,
        stockQuantity: 10,
        reservedQuantity: 3,
      };
      prisma.product.findMany.mockResolvedValue([productWithReserved]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.listActiveProducts({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      expect(result.data[0].availableQuantity).toBe(7);
    });

    it('should return OUT_OF_STOCK when availableQuantity is 0', async () => {
      const outOfStock = {
        ...mockProduct,
        stockQuantity: 5,
        reservedQuantity: 5,
      };
      prisma.product.findMany.mockResolvedValue([outOfStock]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.listActiveProducts({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      expect(result.data[0].stockStatus).toBe('OUT_OF_STOCK');
    });

    it('should return LOW_STOCK when at or below lowStockThreshold', async () => {
      const lowStock = {
        ...mockProduct,
        stockQuantity: 3,
        reservedQuantity: 0,
        lowStockThreshold: 5,
      };
      prisma.product.findMany.mockResolvedValue([lowStock]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.listActiveProducts({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      expect(result.data[0].stockStatus).toBe('LOW_STOCK');
    });

    it('should return IN_STOCK when above lowStockThreshold', async () => {
      prisma.product.findMany.mockResolvedValue([mockProduct]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.listActiveProducts({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      expect(result.data[0].stockStatus).toBe('IN_STOCK');
    });

    it('should return filters in response', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      const result = await service.listActiveProducts({
        page: 1,
        limit: 20,
        sort: 'price_asc',
        search: 'headphone',
        minPrice: '10.00',
      });

      expect(result.filters.search).toBe('headphone');
      expect(result.filters.minPrice).toBe('10.00');
      expect(result.filters.sort).toBe('price_asc');
    });
  });

  describe('getActiveProductBySlug', () => {
    it('should return active product by slug', async () => {
      prisma.product.findFirst.mockResolvedValue(mockProduct);

      const result = await service.getActiveProductBySlug(
        'wireless-headphones',
      );

      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            slug: 'wireless-headphones',
            status: ProductStatus.ACTIVE,
            category: { isActive: true },
          },
        }),
      );
      expect(result.slug).toBe('wireless-headphones');
    });

    it('should throw 404 for inactive product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.getActiveProductBySlug('inactive-product'),
      ).rejects.toThrow(ApiException);
    });

    it('should not expose internal movements or audit info', async () => {
      prisma.product.findFirst.mockResolvedValue(mockProduct);

      const result = await service.getActiveProductBySlug(
        'wireless-headphones',
      );

      expect((result as any).inventoryMovements).toBeUndefined();
      expect((result as any).version).toBeUndefined();
    });
  });
});
