import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsPositive, Min } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({
    description:
      'ID of the shipping address (must belong to authenticated customer and be type SHIPPING)',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  shippingAddressId: number;

  @ApiProperty({
    description:
      'Expected cart version for optimistic concurrency control. Checkout will be rejected if the cart has been modified since this version was fetched.',
    example: 3,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedCartVersion: number;
}
