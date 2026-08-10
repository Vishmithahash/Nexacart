import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export class UpdateProductDto {
  @ApiProperty({
    description: 'Expected current version for optimistic concurrency control',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ApiPropertyOptional({ description: 'New category ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({
    description: 'Product name (2-200 chars)',
    example: 'Updated Wireless Mouse',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  @Transform(({ value }: { value: string }) => value?.trim())
  name?: string;

  @ApiPropertyOptional({
    description: 'URL-safe slug (2-220 chars)',
    example: 'updated-wireless-mouse',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(220)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase kebab-case',
  })
  slug?: string;

  @ApiPropertyOptional({ description: 'Product description (max 5000 chars)' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  @Transform(({ value }: { value: string }) => value?.trim())
  description?: string;

  @ApiPropertyOptional({
    description: 'Price as a decimal string',
    example: '5790.00',
  })
  @IsOptional()
  @IsString()
  @Matches(PRICE_PATTERN, {
    message:
      'Price must be a non-negative decimal with at most two decimal places',
  })
  @Transform(({ value }: { value: string }) => value?.trim())
  price?: string;

  @ApiPropertyOptional({
    description: '3-letter uppercase currency code',
    example: 'LKR',
  })
  @IsOptional()
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN, {
    message: 'currencyCode must be exactly 3 uppercase letters',
  })
  @Transform(({ value }: { value: string }) => value?.trim().toUpperCase())
  currencyCode?: string;

  @ApiPropertyOptional({
    description: 'Low stock alert threshold (0 or more)',
    example: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ description: 'Image URLs (max 10)', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl(
    {},
    { each: true, message: 'Each imageUrl must be a valid http/https URL' },
  )
  imageUrls?: string[];
}
