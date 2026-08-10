import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { OrdersService } from './orders.service';
import { OrdersQueryDto } from './dto/orders-query.dto';

@ApiTags('Orders')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'List my orders',
    description:
      "Returns paginated list of the authenticated customer's orders. Only the authenticated customer's own orders are returned. CUSTOMER only.",
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of customer orders',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not a CUSTOMER' })
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OrdersQueryDto,
  ) {
    return this.ordersService.listMyOrders(user.id, query);
  }

  @Get(':orderNumber')
  @ApiOperation({
    summary: 'Get my order by order number',
    description:
      "Returns the authenticated customer's order by order number. " +
      'Returns the same 404 if the order does not exist or belongs to another customer. CUSTOMER only.',
  })
  @ApiParam({
    name: 'orderNumber',
    type: String,
    description: 'Order number (e.g. NXC-550E8400)',
  })
  @ApiResponse({ status: 200, description: 'Order details' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not a CUSTOMER' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  getOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
  ) {
    return this.ordersService.getMyOrderByOrderNumber(user.id, orderNumber);
  }
}
