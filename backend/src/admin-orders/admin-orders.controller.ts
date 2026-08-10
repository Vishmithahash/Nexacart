import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';

@ApiTags('Admin Orders')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPPORT_AGENT, UserRole.ADMIN)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'List all orders (admin)',
    description:
      'Returns paginated list of all customer orders with customer details. Supports filtering by status, userId, paymentStatus, and date range. Read-only. Accessible by SUPPORT_AGENT and ADMIN.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated order list with customer details',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  listOrders(@Query() query: AdminOrdersQueryDto) {
    return this.adminOrdersService.listOrders(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get order by ID (admin)',
    description:
      'Returns detailed order information including items, shipping address snapshot, and customer details. Read-only. Accessible by SUPPORT_AGENT and ADMIN.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Detailed order information' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  getOrder(@Param('id', ParseIntPipe) orderId: number) {
    return this.adminOrdersService.getOrderById(orderId);
  }
}
