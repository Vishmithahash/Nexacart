import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelOrderDto {
  @ApiProperty({
    description: 'Reason for cancelling the order',
    example: 'Ordered by mistake',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty({ message: 'Cancellation reason is required.' })
  @Transform(({ value }: { value: string }) => value?.trim())
  @MaxLength(500, {
    message: 'Cancellation reason cannot exceed 500 characters.',
  })
  reason: string;
}
