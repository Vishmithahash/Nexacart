import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { CatalogCategoriesQueryDto } from './dto/catalog-categories-query.dto';
import { CatalogProductsQueryDto } from './dto/catalog-products-query.dto';

@ApiTags('Catalogue')
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({
    summary: 'List active categories',
    description:
      'Returns all active categories ordered deterministically by name then ID. Includes count of active products per category.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of active categories',
  })
  listCategories(@Query() query: CatalogCategoriesQueryDto) {
    return this.catalogService.listActiveCategories(query);
  }

  @Get('categories/:slug')
  @ApiOperation({
    summary: 'Get one active category by slug',
    description:
      'Returns a single active category. Returns 404 for inactive or non-existent categories.',
  })
  @ApiParam({
    name: 'slug',
    description: 'Category slug',
    example: 'electronics',
  })
  @ApiResponse({ status: 200, description: 'Active category details' })
  @ApiResponse({ status: 404, description: 'Category not found or inactive' })
  getCategory(@Param('slug') slug: string) {
    return this.catalogService.getActiveCategoryBySlug(slug);
  }

  // ── Products ──────────────────────────────────────────────────────────────

  @Get('products')
  @ApiOperation({
    summary: 'Search and browse active products',
    description:
      'Returns paginated active products with filtering by category, price range, and stock status. Supports case-insensitive search. Sort options: newest, oldest, price_asc, price_desc, name_asc, name_desc. All orderings include an ID tie-breaker.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of active products',
  })
  listProducts(@Query() query: CatalogProductsQueryDto) {
    return this.catalogService.listActiveProducts(query);
  }

  @Get('products/:slug')
  @ApiOperation({
    summary: 'Get one active product by slug',
    description:
      'Returns a single active product in an active category. Returns 404 for inactive or draft products.',
  })
  @ApiParam({
    name: 'slug',
    description: 'Product slug',
    example: 'wireless-headphones',
  })
  @ApiResponse({ status: 200, description: 'Active product details' })
  @ApiResponse({
    status: 404,
    description: 'Product not found, inactive, or in inactive category',
  })
  getProduct(@Param('slug') slug: string) {
    return this.catalogService.getActiveProductBySlug(slug);
  }
}
