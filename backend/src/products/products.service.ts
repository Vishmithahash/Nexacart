import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import {
  InventoryMovementType,
  ProductStatus,
} from '../generated/prisma/client';
import { computeStockStatus, StockStatus } from '../catalog/catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { AdminProductsQueryDto } from './dto/admin-products-query.dto';

// ── Slug generation ────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Response types ─────────────────────────────────────────────────────────

export interface AdminProductResponse {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  currencyCode: string;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
  stockStatus: StockStatus;
  version: number;
  status: ProductStatus;
  imageUrls: string[];
  category: { id: number; name: string; slug: string; isActive: boolean };
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
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async listProducts(query: AdminProductsQueryDto): Promise<{
    data: AdminProductResponse[];
    pagination: PaginationMeta;
  }> {
    const { page, limit, search, categoryId, status, inStock, lowStock, sort } =
      query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId !== undefined) {
      where['categoryId'] = categoryId;
    }

    if (status !== undefined) {
      where['status'] = status;
    }

    const orderBy = this.buildOrderBy(sort);

    // For inStock / lowStock we may need post-filter — fetch broader and filter
    const needsPostFilter = inStock !== undefined || lowStock !== undefined;

    if (needsPostFilter) {
      const allProducts = await this.prisma.product.findMany({
        where,
        orderBy,
        include: {
          category: {
            select: { id: true, name: true, slug: true, isActive: true },
          },
        },
      });

      const filtered = allProducts.filter((p) => {
        const avail = p.stockQuantity - p.reservedQuantity;
        if (inStock === true && avail <= 0) return false;
        if (inStock === false && avail > 0) return false;
        if (lowStock === true && avail > p.lowStockThreshold) return false;
        return true;
      });

      const totalItems = filtered.length;
      const paged = filtered.slice(skip, skip + limit);
      const totalPages = Math.ceil(totalItems / limit);

      return {
        data: paged.map((p) => this.mapAdminProduct(p)),
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

    const [products, totalItems] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          category: {
            select: { id: true, name: true, slug: true, isActive: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      data: products.map((p) => this.mapAdminProduct(p)),
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

  // ── Get one ───────────────────────────────────────────────────────────────

  async getProductById(id: number): Promise<AdminProductResponse> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          select: { id: true, name: true, slug: true, isActive: true },
        },
      },
    });

    if (!product) {
      throw ApiException.productNotFound();
    }

    return this.mapAdminProduct(product);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createProduct(
    dto: CreateProductDto,
    actorUserId: number,
  ): Promise<AdminProductResponse> {
    const sku = dto.sku; // already normalized to uppercase by DTO Transform
    const name = dto.name.trim();
    const slug = dto.slug ?? generateSlug(name);
    const initialStock = dto.initialStock ?? 0;
    const status = (dto.status ?? 'DRAFT') as ProductStatus;
    const currencyCode = (dto.currencyCode ?? 'LKR').toUpperCase();

    // Validate category exists
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: { id: true, isActive: true },
    });
    if (!category) {
      throw ApiException.categoryNotFound();
    }

    // Cannot create ACTIVE product under inactive category
    if (status === ProductStatus.ACTIVE && !category.isActive) {
      throw ApiException.productCategoryInactive();
    }

    // SKU uniqueness
    const existingSku = await this.prisma.product.findUnique({
      where: { sku },
      select: { id: true },
    });
    if (existingSku) {
      throw ApiException.productSkuExists();
    }

    // Slug uniqueness
    const existingSlug = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existingSlug) {
      throw ApiException.productSlugExists();
    }

    // Deduplicate image URLs, preserve order
    const imageUrls = dto.imageUrls ? [...new Set(dto.imageUrls)] : [];

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          categoryId: dto.categoryId,
          sku,
          name,
          slug,
          description: dto.description?.trim() ?? null,
          price: new Decimal(dto.price),
          currencyCode,
          stockQuantity: initialStock,
          reservedQuantity: 0,
          lowStockThreshold: dto.lowStockThreshold ?? 5,
          version: 1,
          status,
          imageUrls,
        },
        include: {
          category: {
            select: { id: true, name: true, slug: true, isActive: true },
          },
        },
      });

      // Create INITIAL_STOCK movement when initialStock > 0
      if (initialStock > 0) {
        await tx.inventoryMovement.create({
          data: {
            productId: created.id,
            actorUserId,
            type: InventoryMovementType.INITIAL_STOCK,
            quantity: initialStock,
            stockBefore: 0,
            stockAfter: initialStock,
            reservedBefore: 0,
            reservedAfter: 0,
            reason: 'Initial stock at product creation',
            metadata: { source: 'product-creation' },
          },
        });
      }

      await this.auditService.logInTransaction(
        {
          userId: actorUserId,
          action: 'PRODUCT_CREATED',
          entityType: 'Product',
          entityId: String(created.id),
          success: true,
          metadata: {
            sku: created.sku,
            name: created.name,
            status: created.status,
            categoryId: created.categoryId,
            initialStock,
            price: created.price.toFixed(2),
            currencyCode: created.currencyCode,
          },
        },
        tx,
      );

      return created;
    });

    return this.mapAdminProduct(product);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateProduct(
    id: number,
    dto: UpdateProductDto,
    actorUserId: number,
  ): Promise<AdminProductResponse> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { category: { select: { id: true, isActive: true } } },
    });

    if (!existing) {
      throw ApiException.productNotFound();
    }

    // Validate category change
    if (
      dto.categoryId !== undefined &&
      dto.categoryId !== existing.categoryId
    ) {
      const newCategory = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: { id: true, isActive: true },
      });
      if (!newCategory) {
        throw ApiException.categoryNotFound();
      }
      if (existing.status === ProductStatus.ACTIVE && !newCategory.isActive) {
        throw ApiException.productCategoryInactive();
      }
    }

    // Validate slug uniqueness if changed
    if (dto.slug && dto.slug !== existing.slug) {
      const duplicate = await this.prisma.product.findFirst({
        where: { slug: dto.slug, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw ApiException.productSlugExists();
    }

    const updateData: Record<string, unknown> = {
      version: { increment: 1 },
    };

    if (dto.categoryId !== undefined) updateData['categoryId'] = dto.categoryId;
    if (dto.name !== undefined) updateData['name'] = dto.name.trim();
    if (dto.slug !== undefined) updateData['slug'] = dto.slug;
    if (dto.description !== undefined)
      updateData['description'] = dto.description.trim();
    if (dto.price !== undefined) updateData['price'] = new Decimal(dto.price);
    if (dto.currencyCode !== undefined)
      updateData['currencyCode'] = dto.currencyCode.toUpperCase();
    if (dto.lowStockThreshold !== undefined)
      updateData['lowStockThreshold'] = dto.lowStockThreshold;
    if (dto.imageUrls !== undefined)
      updateData['imageUrls'] = [...new Set(dto.imageUrls)];

    const before = {
      name: existing.name,
      slug: existing.slug,
      price: existing.price.toFixed(2),
      currencyCode: existing.currencyCode,
      categoryId: existing.categoryId,
      lowStockThreshold: existing.lowStockThreshold,
    };

    // Optimistic concurrency: update only when id AND version match
    const result = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.product.updateMany({
        where: { id, version: dto.expectedVersion },
        data: updateData,
      });

      if (updateResult.count === 0) {
        // Determine if not found or version conflict
        const still = await tx.product.findUnique({
          where: { id },
          select: { id: true, version: true },
        });
        if (!still) throw ApiException.productNotFound();
        throw ApiException.productVersionConflict();
      }

      const updated = await tx.product.findUniqueOrThrow({
        where: { id },
        include: {
          category: {
            select: { id: true, name: true, slug: true, isActive: true },
          },
        },
      });

      await this.auditService.logInTransaction(
        {
          userId: actorUserId,
          action: 'PRODUCT_UPDATED',
          entityType: 'Product',
          entityId: String(id),
          success: true,
          metadata: {
            sku: existing.sku,
            before,
            after: {
              name: updated.name,
              slug: updated.slug,
              price: updated.price.toFixed(2),
              currencyCode: updated.currencyCode,
              categoryId: updated.categoryId,
              lowStockThreshold: updated.lowStockThreshold,
            },
            previousVersion: dto.expectedVersion,
            newVersion: updated.version,
          },
        },
        tx,
      );

      return updated;
    });

    return this.mapAdminProduct(result);
  }

  // ── Status change ─────────────────────────────────────────────────────────

  async updateProductStatus(
    id: number,
    dto: UpdateProductStatusDto,
    actorUserId: number,
  ): Promise<AdminProductResponse> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { category: { select: { id: true, isActive: true } } },
    });

    if (!existing) {
      throw ApiException.productNotFound();
    }

    const newStatus = dto.status;

    // Activating requires active category
    if (newStatus === ProductStatus.ACTIVE && !existing.category.isActive) {
      throw ApiException.productCategoryInactive();
    }

    // Cannot deactivate/draft when reserved stock exists
    if (newStatus !== ProductStatus.ACTIVE && existing.reservedQuantity > 0) {
      throw ApiException.productHasReservedStock();
    }

    // Idempotent: same status, check version still
    const auditAction =
      newStatus === ProductStatus.ACTIVE
        ? 'PRODUCT_ACTIVATED'
        : newStatus === ProductStatus.INACTIVE
          ? 'PRODUCT_DEACTIVATED'
          : 'PRODUCT_MOVED_TO_DRAFT';

    const result = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.product.updateMany({
        where: { id, version: dto.expectedVersion },
        data: {
          status: newStatus,
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        const still = await tx.product.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!still) throw ApiException.productNotFound();
        throw ApiException.productVersionConflict();
      }

      const updated = await tx.product.findUniqueOrThrow({
        where: { id },
        include: {
          category: {
            select: { id: true, name: true, slug: true, isActive: true },
          },
        },
      });

      await this.auditService.logInTransaction(
        {
          userId: actorUserId,
          action: auditAction,
          entityType: 'Product',
          entityId: String(id),
          success: true,
          metadata: {
            sku: existing.sku,
            previousStatus: existing.status,
            newStatus,
            previousVersion: dto.expectedVersion,
            newVersion: updated.version,
          },
        },
        tx,
      );

      return updated;
    });

    return this.mapAdminProduct(result);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  mapAdminProduct(product: {
    id: number;
    sku: string;
    name: string;
    slug: string;
    description: string | null;
    price: Decimal;
    currencyCode: string;
    stockQuantity: number;
    reservedQuantity: number;
    lowStockThreshold: number;
    version: number;
    status: ProductStatus;
    imageUrls: string[];
    createdAt: Date;
    updatedAt: Date;
    category: { id: number; name: string; slug: string; isActive: boolean };
  }): AdminProductResponse {
    const availableQuantity = product.stockQuantity - product.reservedQuantity;
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price.toFixed(2),
      currencyCode: product.currencyCode,
      stockQuantity: product.stockQuantity,
      reservedQuantity: product.reservedQuantity,
      availableQuantity,
      lowStockThreshold: product.lowStockThreshold,
      stockStatus: computeStockStatus(
        availableQuantity,
        product.lowStockThreshold,
      ),
      version: product.version,
      status: product.status,
      imageUrls: product.imageUrls,
      category: product.category,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private buildOrderBy(sort: string): Record<string, 'asc' | 'desc'>[] {
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
