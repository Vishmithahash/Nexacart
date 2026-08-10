import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({
    description: 'Refund amount as a positive decimal string (e.g. "250.00")',
    example: '250.00',
  })
  @IsString()
  @IsNotEmpty({ message: 'Refund amount is required.' })
  @Transform(({ value }: { value: string }) => value?.trim())
  @Matches(/^(?:[1-9]\d*|0)\.\d{2}$/, {
    message:
      'Refund amount must be a positive decimal string with exactly 2 decimal places (e.g. "250.00").',
  })
  amount: string;

  @ApiPropertyOptional({
    description: 'Reason for the refund',
    example: 'Refund after customer cancellation',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  @MaxLength(500, { message: 'Refund reason cannot exceed 500 characters.' })
  reason?: string;
}
