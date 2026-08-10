import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min, Matches } from 'class-validator';

export class UpdateProductStatusDto {
  @ApiProperty({
    description: 'Expected current version for optimistic concurrency control',
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ApiProperty({
    description: 'New product status',
    enum: ['DRAFT', 'ACTIVE', 'INACTIVE'],
    example: 'ACTIVE',
  })
  @IsString()
  @Matches(/^(DRAFT|ACTIVE|INACTIVE)$/, {
    message: 'Status must be DRAFT, ACTIVE, or INACTIVE',
  })
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
}
