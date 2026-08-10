import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { InventoryService } from './inventory.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { InventoryMovementsQueryDto } from './dto/inventory-movements-query.dto';

@ApiTags('Inventory')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Controller('admin/products')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post(':id/inventory-adjustments')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Adjust inventory stock',
    description: `
Applies an ADJUSTMENT_IN or ADJUSTMENT_OUT to product stock.

**Idempotency:**
- New idempotencyKey: applies the adjustment → HTTP 201
- Same key + same params: replayed result, no stock change → HTTP 200 with replayed: true
- Same key + different params: rejected → HTTP 409 INVENTORY_IDEMPOTENCY_CONFLICT

**Concurrency:** Uses Serializable transaction isolation. Stale expectedVersion returns 409 PRODUCT_VERSION_CONFLICT.

**Invariants:**
- stockQuantity cannot go below 0
- stockQuantity cannot fall below reservedQuantity
- reservedQuantity is never modified by this endpoint
- Product version is incremented on successful adjustment

ADMIN only.
    `,
  })
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiResponse({ status: 201, description: 'Adjustment applied' })
  @ApiResponse({
    status: 200,
    description: 'Replayed — idempotency key matched same parameters',
  })
  @ApiResponse({
    status: 400,
    description: 'INVENTORY_ADJUSTMENT_INVALID or INVENTORY_INSUFFICIENT_STOCK',
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({
    status: 409,
    description: 'PRODUCT_VERSION_CONFLICT or INVENTORY_IDEMPOTENCY_CONFLICT',
  })
  async adjustInventory(
    @Param('id', ParseIntPipe) productId: number,
    @Body() dto: AdjustInventoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { result, statusCode } = await this.inventoryService.adjustInventory(
      productId,
      dto,
      user.id,
    );
    res.status(statusCode).json(result);
  }

  @Get(':id/inventory-movements')
  @Roles(UserRole.ADMIN, UserRole.SUPPORT_AGENT)
  @ApiOperation({
    summary: 'Get inventory movement history for a product',
    description:
      'Returns paginated immutable movement records ordered by createdAt descending then ID descending. Filterable by type, date range, and QA correlation IDs. Accessible by ADMIN and SUPPORT_AGENT.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Paginated movement history' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getMovements(
    @Param('id', ParseIntPipe) productId: number,
    @Query() query: InventoryMovementsQueryDto,
  ) {
    return this.inventoryService.getMovements(productId, query);
  }
}
