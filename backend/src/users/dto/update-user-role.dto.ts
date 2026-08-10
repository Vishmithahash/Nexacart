import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from '../../generated/prisma/client';

export class UpdateUserRoleDto {
  @ApiProperty({ enum: UserRole, example: UserRole.SUPPORT_AGENT })
  @IsEnum(UserRole, {
    message: 'Role must be CUSTOMER, SUPPORT_AGENT, or ADMIN.',
  })
  @IsNotEmpty()
  role!: UserRole;
}
