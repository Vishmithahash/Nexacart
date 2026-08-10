import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/exceptions/api.exception';
import { mapOrderToResponse, OrderResponse } from '../orders/order.mapper';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';

export interface AdminOrderListItem extends OrderResponse {
  customer: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export interface PaginatedAdminOrdersResponse {
  data: AdminOrderListItem[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

const ORDER_INCLUDE = {
  items: { orderBy: { id: 'asc' as const } },
  payment: true,
  refunds: { orderBy: { createdAt: 'desc' as const } },
  paymentAttempts: { orderBy: { createdAt: 'desc' as const } },
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  },
} as const;

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrders(
    query: AdminOrdersQueryDto,
  ): Promise<PaginatedAdminOrdersResponse> {
    const {
      page,
      limit,
      status,
      userId,
      paymentStatus,
      sort,
      createdFrom,
      createdTo,
    } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    if (userId) where['userId'] = userId;
    if (paymentStatus) where['paymentStatus'] = paymentStatus;
    if (createdFrom || createdTo) {
      where['createdAt'] = {
        ...(createdFrom ? { gte: new Date(createdFrom) } : {}),
        ...(createdTo ? { lte: new Date(createdTo) } : {}),
      };
    }

    const orderBy =
      sort === 'oldest'
        ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
        : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const [orders, totalItems] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    const data: AdminOrderListItem[] = orders.map((o) => ({
      ...mapOrderToResponse(o),
      customer: o.user,
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

  async getOrderById(orderId: number): Promise<AdminOrderListItem> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });

    if (!order) {
      throw ApiException.orderNotFound();
    }

    return {
      ...mapOrderToResponse(order),
      customer: order.user,
    };
  }
}
