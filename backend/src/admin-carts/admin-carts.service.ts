import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../common/clock/clock.service';
import { ApiException } from '../common/exceptions/api.exception';
import {
  CartStatus,
  InventoryReservationStatus,
} from '../generated/prisma/client';
import { mapCartToResponse, CartResponse } from '../cart/cart.mapper';
import { AdminCartsQueryDto } from './dto/admin-carts-query.dto';

export interface AdminCartListItemResponse extends CartResponse {
  customer: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
  };
}

@Injectable()
export class AdminCartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clockService: ClockService,
  ) {}

  async listCarts(query: AdminCartsQueryDto): Promise<{
    data: AdminCartListItemResponse[];
    pagination: {
      page: number;
      limit: number;
      totalItems: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }> {
    const {
      page,
      limit,
      userId,
      status,
      hasExpiredReservations,
      createdFrom,
      createdTo,
      sort,
    } = query;
    const skip = (page - 1) * limit;
    const now = this.clockService.now();

    const where: Record<string, unknown> = {};
    if (userId) where['userId'] = userId;
    if (status) where['status'] = status;

    if (createdFrom || createdTo) {
      where['createdAt'] = {
        ...(createdFrom ? { gte: new Date(createdFrom) } : {}),
        ...(createdTo ? { lte: new Date(createdTo) } : {}),
      };
    }

    if (hasExpiredReservations !== undefined) {
      where['reservations'] = {
        some: {
          status: InventoryReservationStatus.EXPIRED,
        },
      };
    }

    const orderBy = this.buildOrderBy(sort);

    const [carts, totalItems] = await Promise.all([
      this.prisma.cart.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          items: {
            include: {
              product: true,
              reservations: { orderBy: { createdAt: 'desc' } },
            },
          },
        },
      }),
      this.prisma.cart.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    const data: AdminCartListItemResponse[] = carts.map((c) => {
      const mapped = mapCartToResponse(c, now);
      return {
        ...mapped,
        customer: c.user,
      };
    });

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

  async getCartById(cartId: number): Promise<AdminCartListItemResponse> {
    const now = this.clockService.now();

    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: {
            product: true,
            reservations: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    if (!cart) {
      throw ApiException.cartNotFound();
    }

    const mapped = mapCartToResponse(cart, now);
    return {
      ...mapped,
      customer: cart.user,
    };
  }

  private buildOrderBy(sort: string): Record<string, 'asc' | 'desc'>[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'last_activity':
        return [{ lastActivityAt: 'desc' }, { id: 'desc' }];
      case 'newest':
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }
}
