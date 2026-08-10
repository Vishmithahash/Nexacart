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

export class AdminCartsQueryDto {
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

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({
    description: 'Filter by cart status',
    enum: ['ACTIVE', 'CONVERTED', 'ABANDONED'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'CONVERTED', 'ABANDONED'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter carts with expired reservations',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  hasExpiredReservations?: boolean;

  @ApiPropertyOptional({ description: 'Created from (ISO 8601 string)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Created to (ISO 8601 string)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  createdTo?: string;

  @ApiPropertyOptional({
    description: 'Sort option',
    enum: ['newest', 'oldest', 'last_activity'],
    example: 'newest',
  })
  @IsOptional()
  @IsString()
  @IsIn(['newest', 'oldest', 'last_activity'])
  sort: string = 'newest';
}
