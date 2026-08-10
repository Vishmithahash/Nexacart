import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class CartVersionQueryDto {
  @ApiProperty({
    description: 'Expected cart version for optimistic concurrency control',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'expectedCartVersion must be a positive integer' })
  expectedCartVersion: number;
}
