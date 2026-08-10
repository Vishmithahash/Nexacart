import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class AdminProductsQueryDto {
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
    description: 'Search by name, SKU, description',
    example: 'mouse',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({
    description: 'Filter by product status',
    enum: ['DRAFT', 'ACTIVE', 'INACTIVE'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE'])
  status?: string;

  @ApiPropertyOptional({
    description:
      'Filter by stock availability (true = in stock, false = out of stock)',
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
    description: 'Filter products at or below low stock threshold',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  lowStock?: boolean;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: [
      'newest',
      'oldest',
      'price_asc',
      'price_desc',
      'name_asc',
      'name_desc',
    ],
    example: 'newest',
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'newest',
    'oldest',
    'price_asc',
    'price_desc',
    'name_asc',
    'name_desc',
  ])
  sort: string = 'newest';
}
