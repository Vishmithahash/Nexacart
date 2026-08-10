import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateAgentRunDto {
  @ApiProperty({
    description:
      'Natural language instruction for the NexaCart customer agent.',
    example:
      'Find wireless headphones in stock and add two of them to my cart.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  instruction!: string;
}
