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

/** Strict non-negative decimal string: digits optionally followed by 1-2 decimal places */
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Uppercase SKU: starts with letter/digit, then letters/digits/hyphens/underscores */
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

/** Uppercase 3-letter currency code */
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export class CreateProductDto {
  @ApiProperty({ description: 'Category ID', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId: number;

  @ApiProperty({
    description:
      'Stock Keeping Unit — uppercase letters, digits, hyphens, underscores (2-50 chars)',
    example: 'ELEC-MOUSE-001',
  })
  @IsString()
  @MinLength(2, { message: 'SKU must be at least 2 characters' })
  @MaxLength(50, { message: 'SKU must be at most 50 characters' })
  @Transform(({ value }: { value: string }) => value?.trim().toUpperCase())
  @Matches(SKU_PATTERN, {
    message:
      'SKU must contain only uppercase letters, digits, hyphens, and underscores',
  })
  sku: string;

  @ApiProperty({
    description: 'Product name (2-200 chars)',
    example: 'Wireless Mouse',
  })
  @IsString()
  @MinLength(2, { message: 'Product name must be at least 2 characters' })
  @MaxLength(200, { message: 'Product name must be at most 200 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  name: string;

  @ApiPropertyOptional({
    description: 'URL-safe slug (2-220 chars). Generated from name if omitted.',
    example: 'wireless-mouse',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Slug must be at least 2 characters' })
  @MaxLength(220, { message: 'Slug must be at most 220 characters' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase kebab-case',
  })
  slug?: string;

  @ApiPropertyOptional({
    description: 'Product description (max 5000 chars)',
    example: 'A rechargeable wireless mouse',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Description must be at most 5000 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  description?: string;

  @ApiProperty({
    description:
      'Price as a decimal string — non-negative, at most 2 decimal places',
    example: '5490.00',
  })
  @IsString()
  @Matches(PRICE_PATTERN, {
    message:
      'Price must be a non-negative decimal string with at most two decimal places',
  })
  @Transform(({ value }: { value: string }) => value?.trim())
  price: string;

  @ApiPropertyOptional({
    description: '3-letter uppercase currency code',
    example: 'LKR',
    default: 'LKR',
  })
  @IsOptional()
  @IsString()
  @Matches(CURRENCY_CODE_PATTERN, {
    message: 'currencyCode must be exactly 3 uppercase letters (e.g. LKR)',
  })
  @Transform(({ value }: { value: string }) => value?.trim().toUpperCase())
  currencyCode?: string = 'LKR';

  @ApiPropertyOptional({
    description: 'Initial stock quantity (0 or more)',
    example: 25,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  initialStock?: number = 0;

  @ApiPropertyOptional({
    description: 'Low stock alert threshold (0 or more)',
    example: 5,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lowStockThreshold?: number = 5;

  @ApiPropertyOptional({
    description:
      'Product status (DRAFT or ACTIVE — cannot create in ACTIVE if category is inactive)',
    enum: ['DRAFT', 'ACTIVE'],
    example: 'DRAFT',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(DRAFT|ACTIVE)$/, {
    message: 'Status must be DRAFT or ACTIVE at creation',
  })
  status?: 'DRAFT' | 'ACTIVE' = 'DRAFT';

  @ApiPropertyOptional({
    description: 'Image URLs (max 10, each must be http/https)',
    type: [String],
    example: [],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'At most 10 image URLs allowed' })
  @IsUrl(
    {},
    { each: true, message: 'Each imageUrl must be a valid http/https URL' },
  )
  imageUrls?: string[] = [];
}
