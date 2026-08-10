import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateCategoryDto {
  @ApiPropertyOptional({
    description: 'Category name (2-100 chars)',
    example: 'Updated Accessories',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Category name must be at least 2 characters' })
  @MaxLength(100, { message: 'Category name must be at most 100 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  name?: string;

  @ApiPropertyOptional({
    description: 'URL-safe slug (2-120 chars, lowercase kebab-case)',
    example: 'updated-accessories',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Category slug must be at least 2 characters' })
  @MaxLength(120, { message: 'Category slug must be at most 120 characters' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase kebab-case (e.g. updated-accessories)',
  })
  slug?: string;

  @ApiPropertyOptional({ description: 'Optional category description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Description must be at most 1000 characters' })
  @Transform(({ value }: { value: string }) => value?.trim())
  description?: string;
}
