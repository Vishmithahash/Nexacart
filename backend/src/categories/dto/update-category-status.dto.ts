import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateCategoryStatusDto {
  @ApiProperty({
    description:
      'Set to true to activate or false to deactivate. Deactivation fails if active products exist.',
    example: false,
  })
  @IsBoolean()
  isActive: boolean;
}
