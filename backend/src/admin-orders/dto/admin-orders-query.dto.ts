import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminOrdersQueryDto {
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
    description: 'Filter by order status',
    enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'CANCELLED', 'COMPLETED'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'CONFIRMED', 'PROCESSING', 'CANCELLED', 'COMPLETED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({
    description: 'Filter by payment status',
    enum: [
      'PENDING',
      'AUTHORIZED',
      'PAID',
      'FAILED',
      'REFUNDED',
      'PARTIALLY_REFUNDED',
    ],
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'PENDING',
    'AUTHORIZED',
    'PAID',
    'FAILED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
  ])
  paymentStatus?: string;

  @ApiPropertyOptional({
    description: 'Sort option',
    enum: ['newest', 'oldest'],
    example: 'newest',
  })
  @IsOptional()
  @IsString()
  @IsIn(['newest', 'oldest'])
  sort: string = 'newest';

  @ApiPropertyOptional({ description: 'Created from (ISO 8601)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Created to (ISO 8601)' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  createdTo?: string;
}
