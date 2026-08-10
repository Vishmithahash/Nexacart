import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export const CATALOG_SORT_OPTIONS = [
  'newest',
  'oldest',
  'price_asc',
  'price_desc',
  'name_asc',
  'name_desc',
] as const;

export type CatalogSortOption = (typeof CATALOG_SORT_OPTIONS)[number];

/** Strict decimal string: non-negative, max 2 decimal places */
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CatalogProductsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page (max 100)',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: 'Case-insensitive search on name, SKU, description',
    example: 'wireless',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  search?: string;

  @ApiPropertyOptional({ description: 'Category slug', example: 'electronics' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  category?: string;

  @ApiPropertyOptional({
    description: 'Minimum price (decimal string)',
    example: '100.00',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, {
    message:
      'minPrice must be a non-negative decimal with at most two decimal places',
  })
  @Transform(({ value }: { value: string }) => value?.trim())
  minPrice?: string;

  @ApiPropertyOptional({
    description: 'Maximum price (decimal string)',
    example: '500.00',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, {
    message:
      'maxPrice must be a non-negative decimal with at most two decimal places',
  })
  @Transform(({ value }: { value: string }) => value?.trim())
  maxPrice?: string;

  @ApiPropertyOptional({
    description:
      'Filter by stock availability. true = in stock, false = out of stock',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: CATALOG_SORT_OPTIONS,
    example: 'newest',
  })
  @IsOptional()
  @IsString()
  @IsIn(CATALOG_SORT_OPTIONS, {
    message: `sort must be one of: ${CATALOG_SORT_OPTIONS.join(', ')}`,
  })
  sort: CatalogSortOption = 'newest';
}
