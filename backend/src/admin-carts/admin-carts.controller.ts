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
import { AdminCartsService } from './admin-carts.service';
import { AdminCartsQueryDto } from './dto/admin-carts-query.dto';

@ApiTags('Admin Carts')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPPORT_AGENT, UserRole.ADMIN)
@Controller('admin/carts')
export class AdminCartsController {
  constructor(private readonly adminCartsService: AdminCartsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all customer carts (admin)',
    description:
      'Returns paginated customer carts with filtering by userId, status, expired reservations, and date range. Accessible by SUPPORT_AGENT and ADMIN.',
  })
  @ApiResponse({ status: 200, description: 'Paginated cart list' })
  listCarts(@Query() query: AdminCartsQueryDto) {
    return this.adminCartsService.listCarts(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get customer cart details by ID (admin)',
    description:
      'Returns detailed cart information for a customer including items, price snapshots, current prices, and reservation status. Accessible by SUPPORT_AGENT and ADMIN.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Cart ID' })
  @ApiResponse({ status: 200, description: 'Detailed cart information' })
  @ApiResponse({ status: 404, description: 'Cart not found' })
  getCart(@Param('id', ParseIntPipe) cartId: number) {
    return this.adminCartsService.getCartById(cartId);
  }
}
