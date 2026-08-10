import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'New quantity (must be between 1 and max item quantity)',
    example: 5,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, {
    message: 'quantity must be at least 1 (use DELETE route to remove item)',
  })
  quantity: number;

  @ApiProperty({
    description: 'Expected cart version for optimistic concurrency control',
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'expectedCartVersion must be a positive integer' })
  expectedCartVersion: number;
}
