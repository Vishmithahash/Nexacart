import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsString } from 'class-validator';

export class PayOrderDto {
  @ApiProperty({
    description: 'Payment method. Only MOCK is supported in Phase 6.',
    example: 'MOCK',
    enum: ['MOCK'],
  })
  @IsString()
  @Equals('MOCK', { message: 'Only MOCK payment method is supported.' })
  method: string = 'MOCK';
}
