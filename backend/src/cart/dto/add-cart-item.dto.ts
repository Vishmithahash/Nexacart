import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ description: 'Product ID to add to cart', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @ApiProperty({
    description: 'Quantity to add (must be positive integer)',
    example: 2,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'quantity must be a positive integer' })
  quantity: number;

  @ApiProperty({
    description:
      'Expected cart version for optimistic concurrency control (use 0 for initial cart creation)',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'expectedCartVersion must be 0 or greater' })
  expectedCartVersion: number;
}
