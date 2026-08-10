import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/exceptions/api.exception';
import { mapOrderToResponse, OrderResponse } from './order.mapper';
import { OrdersQueryDto } from './dto/orders-query.dto';

export interface PaginatedOrdersResponse {
  data: OrderResponse[];
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
  items: {
    orderBy: { id: 'asc' as const },
  },
  payment: true,
  refunds: {
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listMyOrders(
    userId: number,
    query: OrdersQueryDto,
  ): Promise<PaginatedOrdersResponse> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [orders, totalItems] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        include: ORDER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      data: orders.map(mapOrderToResponse),
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

  async getMyOrderByOrderNumber(
    userId: number,
    orderNumber: string,
  ): Promise<OrderResponse> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: ORDER_INCLUDE,
    });

    // Return same 404 regardless of whether order exists but belongs to another user
    if (!order || order.userId !== userId) {
      throw ApiException.orderNotFound();
    }

    return mapOrderToResponse(order);
  }
}
