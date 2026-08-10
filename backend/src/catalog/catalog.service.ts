import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/exceptions/api.exception';
import { ProductStatus } from '../generated/prisma/client';
import { CatalogCategoriesQueryDto } from './dto/catalog-categories-query.dto';
import { CatalogProductsQueryDto } from './dto/catalog-products-query.dto';

// ── Computed stock status ──────────────────────────────────────────────────

export type StockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';

export function computeStockStatus(
  availableQuantity: number,
  lowStockThreshold: number,
): StockStatus {
  if (availableQuantity === 0) return 'OUT_OF_STOCK';
  if (availableQuantity <= lowStockThreshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

// ── Response mappers ───────────────────────────────────────────────────────

export interface PublicCategoryItem {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  activeProductCount: number;
}

export interface PublicProductItem {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  currencyCode: string;
  imageUrls: string[];
  category: { id: number; name: string; slug: string };
  availableQuantity: number;
  stockStatus: StockStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  async listActiveCategories(query: CatalogCategoriesQueryDto): Promise<{
    data: PublicCategoryItem[];
    pagination: PaginationMeta;
  }> {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const where = {
      isActive: true,
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [categories, totalItems] = await Promise.all([
      this.prisma.category.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
        include: {
          _count: {
            select: { products: { where: { status: ProductStatus.ACTIVE } } },
          },
        },
      }),
      this.prisma.category.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    const data: PublicCategoryItem[] = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      activeProductCount: cat._count.products,
    }));

    return {
      data,
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

  async getActiveCategoryBySlug(slug: string): Promise<PublicCategoryItem> {
    const category = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      include: {
        _count: {
          select: { products: { where: { status: ProductStatus.ACTIVE } } },
        },
      },
    });

    if (!category) {
      throw ApiException.categoryNotFound();
    }

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      activeProductCount: category._count.products,
    };
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async listActiveProducts(query: CatalogProductsQueryDto): Promise<{
    data: PublicProductItem[];
    pagination: PaginationMeta;
    filters: {
      search: string | null;
      category: string | null;
      minPrice: string | null;
      maxPrice: string | null;
      inStock: boolean | null;
      sort: string;
    };
  }> {
    const { page, limit, search, category, minPrice, maxPrice, inStock, sort } =
      query;
    const skip = (page - 1) * limit;

    // Build where clause — only ACTIVE products in ACTIVE categories
    const where: Record<string, unknown> = {
      status: ProductStatus.ACTIVE,
      category: { isActive: true },
    };

    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where['category'] = { isActive: true, slug: category };
    }

    if (minPrice !== undefined) {
      where['price'] = {
        ...(where['price'] as object | undefined),
        gte: new Decimal(minPrice),
      };
    }

    if (maxPrice !== undefined) {
      where['price'] = {
        ...(where['price'] as object | undefined),
        lte: new Decimal(maxPrice),
      };
    }

    // inStock filtering: availableQuantity = stockQuantity - reservedQuantity
    // Prisma doesn't support computed field filtering, so use raw comparisons
    if (inStock === true) {
      // availableQuantity > 0 ⟹ stockQuantity > reservedQuantity
      where['stockQuantity'] = {
        gt: this.prisma.product.fields?.reservedQuantity,
      };
    } else if (inStock === false) {
      // availableQuantity === 0 ⟹ stockQuantity === reservedQuantity
    }

    // We handle inStock by fetching and filtering (alternative safe approach)
    const orderBy = this.buildOrderBy(sort);

    if (inStock !== undefined) {
      // Fetch with a broader query and filter in-memory for inStock
      // This is safe for controlled data volumes; raw SQL avoided intentionally
      const allProducts = await this.prisma.product.findMany({
        where: { ...where, stockQuantity: undefined },
        orderBy,
        include: { category: { select: { id: true, name: true, slug: true } } },
      });

      const filtered = allProducts.filter((p) => {
        const avail = p.stockQuantity - p.reservedQuantity;
        return inStock ? avail > 0 : avail === 0;
      });

      const totalItems = filtered.length;
      const paged = filtered.slice(skip, skip + limit);
      const totalPages = Math.ceil(totalItems / limit);

      return {
        data: paged.map((p) => this.mapPublicProduct(p)),
        pagination: {
          page,
          limit,
          totalItems,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        filters: {
          search: search ?? null,
          category: category ?? null,
          minPrice: minPrice ?? null,
          maxPrice: maxPrice ?? null,
          inStock: inStock ?? null,
          sort,
        },
      };
    }

    // Remove the stockQuantity override from earlier attempt
    delete where['stockQuantity'];

    const [products, totalItems] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { category: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      data: products.map((p) => this.mapPublicProduct(p)),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters: {
        search: search ?? null,
        category: category ?? null,
        minPrice: minPrice ?? null,
        maxPrice: maxPrice ?? null,
        inStock: inStock ?? null,
        sort,
      },
    };
  }

  async getActiveProductBySlug(slug: string): Promise<PublicProductItem> {
    const product = await this.prisma.product.findFirst({
      where: {
        slug,
        status: ProductStatus.ACTIVE,
        category: { isActive: true },
      },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    if (!product) {
      throw ApiException.productNotFound();
    }

    return this.mapPublicProduct(product);
  }

  async getActiveProductById(id: number): Promise<PublicProductItem> {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        status: ProductStatus.ACTIVE,
        category: { isActive: true },
      },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    if (!product) {
      throw ApiException.productNotFound();
    }

    return this.mapPublicProduct(product);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private mapPublicProduct(product: {
    id: number;
    sku: string;
    name: string;
    slug: string;
    description: string | null;
    price: Decimal;
    currencyCode: string;
    imageUrls: string[];
    stockQuantity: number;
    reservedQuantity: number;
    lowStockThreshold: number;
    createdAt: Date;
    updatedAt: Date;
    category: { id: number; name: string; slug: string };
  }): PublicProductItem {
    const availableQuantity = product.stockQuantity - product.reservedQuantity;
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price.toFixed(2),
      currencyCode: product.currencyCode,
      imageUrls: product.imageUrls,
      category: product.category,
      availableQuantity,
      stockStatus: computeStockStatus(
        availableQuantity,
        product.lowStockThreshold,
      ),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private buildOrderBy(
    sort: string,
  ): Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'price_asc':
        return [{ price: 'asc' }, { id: 'asc' }];
      case 'price_desc':
        return [{ price: 'desc' }, { id: 'asc' }];
      case 'name_asc':
        return [{ name: 'asc' }, { id: 'asc' }];
      case 'name_desc':
        return [{ name: 'desc' }, { id: 'asc' }];
      case 'newest':
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }
}
