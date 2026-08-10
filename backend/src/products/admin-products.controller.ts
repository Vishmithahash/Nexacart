import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { AdminProductsQueryDto } from './dto/admin-products-query.dto';

@ApiTags('Admin Products')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPPORT_AGENT)
  @ApiOperation({
    summary: 'List all products (admin)',
    description:
      'Returns all products with full inventory details. Accessible by ADMIN and SUPPORT_AGENT.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated product list with stock information',
  })
  listProducts(@Query() query: AdminProductsQueryDto) {
    return this.productsService.listProducts(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPPORT_AGENT)
  @ApiOperation({ summary: 'Get one product by ID (admin)' })
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiResponse({
    status: 200,
    description: 'Product details with stock information',
  })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.getProductById(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a new product',
    description:
      'Creates a product with optional initial stock. SKU is normalized to uppercase. Price accepted as decimal string. ADMIN only.',
  })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({
    status: 409,
    description:
      'PRODUCT_SKU_EXISTS, PRODUCT_SLUG_EXISTS, or PRODUCT_CATEGORY_INACTIVE',
  })
  createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.createProduct(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update a product',
    description:
      'Updates product fields. Requires expectedVersion for optimistic concurrency. SKU is immutable. stockQuantity and reservedQuantity cannot be changed directly. ADMIN only.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiResponse({ status: 404, description: 'Product or category not found' })
  @ApiResponse({
    status: 409,
    description:
      'PRODUCT_VERSION_CONFLICT, PRODUCT_SLUG_EXISTS, or PRODUCT_CATEGORY_INACTIVE',
  })
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.updateProduct(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Change product status',
    description:
      'Changes product status (DRAFT, ACTIVE, INACTIVE). Requires expectedVersion. Activating requires active category. Deactivating is blocked when reservedQuantity > 0. ADMIN only.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Status changed' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({
    status: 409,
    description:
      'PRODUCT_VERSION_CONFLICT, PRODUCT_CATEGORY_INACTIVE, or PRODUCT_HAS_RESERVED_STOCK',
  })
  updateProductStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.updateProductStatus(id, dto, user.id);
  }
}
