import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AdjustInventoryDto {
  @ApiProperty({
    description:
      'Movement type — only ADJUSTMENT_IN and ADJUSTMENT_OUT are allowed',
    enum: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'],
    example: 'ADJUSTMENT_IN',
  })
  @IsString()
  @IsIn(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'], {
    message: 'type must be ADJUSTMENT_IN or ADJUSTMENT_OUT',
  })
  type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';

  @ApiProperty({
    description: 'Positive integer quantity to adjust',
    example: 10,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'quantity must be a positive integer' })
  quantity: number;

  @ApiProperty({
    description: 'Reason for adjustment (3-500 chars)',
    example: 'New supplier delivery',
  })
  @IsString()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must be at most 500 characters' })
  reason: string;

  @ApiProperty({
    description:
      'Expected current product version for optimistic concurrency control',
    example: 3,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ApiProperty({
    description:
      'Idempotency key (8-100 chars). Identical key+params = replayed result. Same key with different params = 409.',
    example: 'inventory-adjustment-20260804-001',
    minLength: 8,
    maxLength: 100,
  })
  @IsString()
  @MinLength(8, { message: 'idempotencyKey must be at least 8 characters' })
  @MaxLength(100, { message: 'idempotencyKey must be at most 100 characters' })
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message:
      'idempotencyKey must contain only letters, digits, hyphens, and underscores',
  })
  idempotencyKey: string;
}
