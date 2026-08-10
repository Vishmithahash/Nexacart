import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
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
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { ReserveCartItemDto } from './dto/reserve-cart-item.dto';
import { CartVersionQueryDto } from './dto/cart-version-query.dto';

@ApiTags('Cart')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'Get active cart',
    description:
      'Returns the authenticated customer active cart. Creates a new empty cart if none exists. Automatically processes expired reservations. CUSTOMER only.',
  })
  @ApiResponse({ status: 200, description: 'Active cart details' })
  getActiveCart(@CurrentUser() user: AuthenticatedUser) {
    return this.cartService.getActiveCart(user.id);
  }

  @Post('items')
  @ApiOperation({
    summary: 'Add item to cart',
    description:
      'Adds a product to cart and reserves inventory. Idempotent based on X-Idempotency-Key header. CUSTOMER only.',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description: 'Unique key (8-100 characters) for idempotent execution',
  })
  @ApiResponse({
    status: 201,
    description: 'Item added and inventory reserved',
  })
  @ApiResponse({ status: 200, description: 'Replayed idempotent response' })
  @ApiResponse({ status: 400, description: 'Validation or limit error' })
  @ApiResponse({
    status: 409,
    description: 'Stock, version, or idempotency conflict',
  })
  async addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Res() res: Response,
  ) {
    const { body, replayed } = await this.cartService.addItem(
      user.id,
      dto,
      idempotencyKey,
    );
    const statusCode = replayed ? 200 : 201;
    res.status(statusCode).json(body);
  }

  @Patch('items/:itemId')
  @ApiOperation({
    summary: 'Update cart item quantity',
    description:
      'Updates cart item quantity and adjusts reserved stock. Requires expectedCartVersion. CUSTOMER only.',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description: 'Unique key (8-100 characters)',
  })
  @ApiParam({ name: 'itemId', type: Number, description: 'Cart Item ID' })
  @ApiResponse({ status: 200, description: 'Quantity updated' })
  @ApiResponse({ status: 404, description: 'Cart item not found' })
  @ApiResponse({
    status: 409,
    description: 'Stock, version, or idempotency conflict',
  })
  async updateItemQuantity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateCartItemDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Res() res: Response,
  ) {
    const { body } = await this.cartService.updateItemQuantity(
      user.id,
      itemId,
      dto,
      idempotencyKey,
    );
    res.status(200).json(body);
  }

  @Delete('items/:itemId')
  @ApiOperation({
    summary: 'Remove item from cart',
    description:
      'Removes a cart item and releases its active stock reservation. CUSTOMER only.',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description: 'Unique key (8-100 characters)',
  })
  @ApiParam({ name: 'itemId', type: Number, description: 'Cart Item ID' })
  @ApiResponse({
    status: 200,
    description: 'Item removed and reservation released',
  })
  @ApiResponse({ status: 404, description: 'Cart item not found' })
  @ApiResponse({ status: 409, description: 'Version or idempotency conflict' })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Query() query: CartVersionQueryDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Res() res: Response,
  ) {
    const { body } = await this.cartService.removeItem(
      user.id,
      itemId,
      query.expectedCartVersion,
      idempotencyKey,
    );
    res.status(200).json(body);
  }

  @Delete('items')
  @ApiOperation({
    summary: 'Clear cart',
    description:
      'Removes all items from the active cart and releases all active stock reservations. CUSTOMER only.',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description: 'Unique key (8-100 characters)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cart cleared and all reservations released',
  })
  @ApiResponse({ status: 409, description: 'Version or idempotency conflict' })
  async clearCart(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CartVersionQueryDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Res() res: Response,
  ) {
    const { body } = await this.cartService.clearCart(
      user.id,
      query.expectedCartVersion,
      idempotencyKey,
    );
    res.status(200).json(body);
  }

  @Post('items/:itemId/reserve')
  @ApiOperation({
    summary: 'Re-reserve expired cart item',
    description:
      'Re-reserves stock for an expired cart item at current product price. CUSTOMER only.',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description: 'Unique key (8-100 characters)',
  })
  @ApiParam({ name: 'itemId', type: Number, description: 'Cart Item ID' })
  @ApiResponse({ status: 200, description: 'Item re-reserved successfully' })
  @ApiResponse({
    status: 409,
    description: 'Stock, version, or status conflict',
  })
  async reserveCartItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: ReserveCartItemDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Res() res: Response,
  ) {
    const { body } = await this.cartService.reserveCartItem(
      user.id,
      itemId,
      dto,
      idempotencyKey,
    );
    res.status(200).json(body);
  }
}
