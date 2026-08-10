import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserStatus } from '../../generated/prisma/client';

export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus, example: UserStatus.SUSPENDED })
  @IsEnum(UserStatus, {
    message: 'Status must be ACTIVE, SUSPENDED, or DISABLED.',
  })
  @IsNotEmpty()
  status!: UserStatus;
}
