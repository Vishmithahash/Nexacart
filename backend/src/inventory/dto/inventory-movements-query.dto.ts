import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class InventoryMovementsQueryDto {
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
    description: 'Filter by movement type',
    enum: [
      'INITIAL_STOCK',
      'ADJUSTMENT_IN',
      'ADJUSTMENT_OUT',
      'RESERVATION',
      'RELEASE',
      'SALE',
      'RETURN',
      'CORRECTION',
    ],
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'INITIAL_STOCK',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT',
    'RESERVATION',
    'RELEASE',
    'SALE',
    'RETURN',
    'CORRECTION',
  ])
  type?: string;

  @ApiPropertyOptional({
    description: 'Filter from date (ISO 8601)',
    example: '2026-08-01T00:00:00Z',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter to date (ISO 8601)',
    example: '2026-08-31T23:59:59Z',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Filter by request ID for QA correlation',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  requestId?: string;

  @ApiPropertyOptional({ description: 'Filter by QA run ID' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  qaRunId?: string;

  @ApiPropertyOptional({ description: 'Filter by tool call ID' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Transform(({ value }: { value: string }) => value?.trim())
  toolCallId?: string;
}
