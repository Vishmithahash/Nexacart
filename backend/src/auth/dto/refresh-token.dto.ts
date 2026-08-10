import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Opaque refresh token received during login or register',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
