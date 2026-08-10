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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateCategoryStatusDto } from './dto/update-category-status.dto';
import { AdminCategoriesQueryDto } from './dto/admin-categories-query.dto';

@ApiTags('Admin Categories')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPPORT_AGENT)
  @ApiOperation({
    summary: 'List all categories (admin)',
    description:
      'Returns all categories including inactive ones. Accessible by ADMIN and SUPPORT_AGENT.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of categories' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  listCategories(@Query() query: AdminCategoriesQueryDto) {
    return this.categoriesService.listCategories(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPPORT_AGENT)
  @ApiOperation({ summary: 'Get one category by ID (admin)' })
  @ApiParam({ name: 'id', type: Number, description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Category details' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  getCategory(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.getCategoryById(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create a new category',
    description:
      'Creates a category. Slug is generated from name if not provided. Name and slug must be unique (case-insensitive for name). ADMIN only.',
  })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({
    status: 409,
    description: 'CATEGORY_NAME_EXISTS or CATEGORY_SLUG_EXISTS',
  })
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categoriesService.createCategory(dto, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update a category',
    description:
      'Updates name, slug, and/or description. Use the /status endpoint to change isActive. ADMIN only.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({
    status: 409,
    description: 'CATEGORY_NAME_EXISTS or CATEGORY_SLUG_EXISTS',
  })
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categoriesService.updateCategory(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Change category active status',
    description:
      'Activates or deactivates a category. Deactivation is blocked when active products exist (CATEGORY_HAS_ACTIVE_PRODUCTS). Repeated requests with same value are idempotent. ADMIN only.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Status changed' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'CATEGORY_HAS_ACTIVE_PRODUCTS' })
  updateCategoryStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.categoriesService.updateCategoryStatus(id, dto, user.id);
  }
}
