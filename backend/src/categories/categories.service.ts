import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import { ProductStatus } from '../generated/prisma/client';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateCategoryStatusDto } from './dto/update-category-status.dto';
import { AdminCategoriesQueryDto } from './dto/admin-categories-query.dto';

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

export interface AdminCategoryResponse {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
  activeProductCount: number;
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
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async listCategories(query: AdminCategoriesQueryDto): Promise<{
    data: AdminCategoryResponse[];
    pagination: PaginationMeta;
  }> {
    const { page, limit, search, isActive, sort } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (search) {
      where['name'] = { contains: search, mode: 'insensitive' };
    }
    if (isActive !== undefined) {
      where['isActive'] = isActive;
    }

    const orderBy = this.buildOrderBy(sort);

    const [categories, totalItems] = await Promise.all([
      this.prisma.category.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              products: true,
            },
          },
        },
      }),
      this.prisma.category.count({ where }),
    ]);

    // Count active products per category (separate query for admin accuracy)
    const categoryIds = categories.map((c) => c.id);
    const activeCounts = await Promise.all(
      categoryIds.map((id) =>
        this.prisma.product.count({
          where: { categoryId: id, status: ProductStatus.ACTIVE },
        }),
      ),
    );

    const totalPages = Math.ceil(totalItems / limit);

    const data: AdminCategoryResponse[] = categories.map((cat, idx) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      isActive: cat.isActive,
      productCount: cat._count.products,
      activeProductCount: activeCounts[idx],
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
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

  // ── Get one ───────────────────────────────────────────────────────────────

  async getCategoryById(id: number): Promise<AdminCategoryResponse> {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } },
      },
    });

    if (!cat) {
      throw ApiException.categoryNotFound();
    }

    const activeProductCount = await this.prisma.product.count({
      where: { categoryId: id, status: ProductStatus.ACTIVE },
    });

    return {
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      isActive: cat.isActive,
      productCount: cat._count.products,
      activeProductCount,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
    };
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createCategory(
    dto: CreateCategoryDto,
    actorUserId: number,
  ): Promise<AdminCategoryResponse> {
    const name = dto.name.trim();
    const slug = dto.slug ?? generateSlug(name);

    // Case-insensitive name uniqueness check at service level
    const existingByName = await this.prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingByName) {
      throw ApiException.categoryNameExists();
    }

    // Slug uniqueness check
    const existingBySlug = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existingBySlug) {
      throw ApiException.categorySlugExists();
    }

    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          name,
          slug,
          description: dto.description?.trim() ?? null,
          isActive: dto.isActive ?? true,
        },
        include: { _count: { select: { products: true } } },
      });

      await this.auditService.logInTransaction(
        {
          userId: actorUserId,
          action: 'CATEGORY_CREATED',
          entityType: 'Category',
          entityId: String(created.id),
          success: true,
          metadata: {
            name: created.name,
            slug: created.slug,
            isActive: created.isActive,
          },
        },
        tx,
      );

      return created;
    });

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      isActive: category.isActive,
      productCount: category._count.products,
      activeProductCount: 0,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateCategory(
    id: number,
    dto: UpdateCategoryDto,
    actorUserId: number,
  ): Promise<AdminCategoryResponse> {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isActive: true,
      },
    });

    if (!existing) {
      throw ApiException.categoryNotFound();
    }

    const updateData: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      // Case-insensitive uniqueness (exclude self)
      const duplicate = await this.prisma.category.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          id: { not: id },
        },
        select: { id: true },
      });
      if (duplicate) throw ApiException.categoryNameExists();
      updateData['name'] = name;
    }

    if (dto.slug !== undefined) {
      const duplicate = await this.prisma.category.findFirst({
        where: { slug: dto.slug, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw ApiException.categorySlugExists();
      updateData['slug'] = dto.slug;
    }

    if (dto.description !== undefined) {
      updateData['description'] = dto.description.trim();
    }

    const before = {
      name: existing.name,
      slug: existing.slug,
      description: existing.description,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.category.update({
        where: { id },
        data: updateData,
        include: { _count: { select: { products: true } } },
      });

      await this.auditService.logInTransaction(
        {
          userId: actorUserId,
          action: 'CATEGORY_UPDATED',
          entityType: 'Category',
          entityId: String(id),
          success: true,
          metadata: {
            before,
            after: {
              name: result.name,
              slug: result.slug,
              description: result.description,
            },
          },
        },
        tx,
      );

      return result;
    });

    const activeProductCount = await this.prisma.product.count({
      where: { categoryId: id, status: ProductStatus.ACTIVE },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      isActive: updated.isActive,
      productCount: updated._count.products,
      activeProductCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async updateCategoryStatus(
    id: number,
    dto: UpdateCategoryStatusDto,
    actorUserId: number,
  ): Promise<AdminCategoryResponse> {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        isActive: true,
        name: true,
        slug: true,
        description: true,
      },
    });

    if (!existing) {
      throw ApiException.categoryNotFound();
    }

    // Idempotent: no change needed
    if (existing.isActive === dto.isActive) {
      const activeProductCount = await this.prisma.product.count({
        where: { categoryId: id, status: ProductStatus.ACTIVE },
      });
      const cat = await this.prisma.category.findUnique({
        where: { id },
        include: { _count: { select: { products: true } } },
      });
      return {
        id: cat!.id,
        name: cat!.name,
        slug: cat!.slug,
        description: cat!.description,
        isActive: cat!.isActive,
        productCount: cat!._count.products,
        activeProductCount,
        createdAt: cat!.createdAt,
        updatedAt: cat!.updatedAt,
      };
    }

    // Cannot deactivate while active products exist
    if (!dto.isActive) {
      const activeProductCount = await this.prisma.product.count({
        where: { categoryId: id, status: ProductStatus.ACTIVE },
      });
      if (activeProductCount > 0) {
        throw ApiException.categoryHasActiveProducts();
      }
    }

    const auditAction = dto.isActive
      ? 'CATEGORY_ACTIVATED'
      : 'CATEGORY_DEACTIVATED';

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.category.update({
        where: { id },
        data: { isActive: dto.isActive },
        include: { _count: { select: { products: true } } },
      });

      await this.auditService.logInTransaction(
        {
          userId: actorUserId,
          action: auditAction,
          entityType: 'Category',
          entityId: String(id),
          success: true,
          metadata: {
            previousIsActive: existing.isActive,
            newIsActive: dto.isActive,
          },
        },
        tx,
      );

      return result;
    });

    const activeProductCount = await this.prisma.product.count({
      where: { categoryId: id, status: ProductStatus.ACTIVE },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      isActive: updated.isActive,
      productCount: updated._count.products,
      activeProductCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildOrderBy(sort: string): Record<string, 'asc' | 'desc'>[] {
    switch (sort) {
      case 'name_desc':
        return [{ name: 'desc' }, { id: 'asc' }];
      case 'newest':
        return [{ createdAt: 'desc' }, { id: 'desc' }];
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'name_asc':
      default:
        return [{ name: 'asc' }, { id: 'asc' }];
    }
  }
}
