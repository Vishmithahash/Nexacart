import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UsersService, PaginatedUsersResponse } from './users.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { SafeUserResponse } from '../auth/auth.service';

@ApiTags('Admin Users')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users (Admin only)',
    description:
      'Returns paginated users with optional role, status, and search filters.',
  })
  @ApiResponse({
    status: 200,
    description: 'Users list retrieved successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden (Admin role required).' })
  async listUsers(
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedUsersResponse> {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get user by ID (Admin only)',
    description: 'Returns user profile for the given ID.',
  })
  @ApiResponse({ status: 200, description: 'User retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUserById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SafeUserResponse> {
    return this.usersService.getUserById(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update user status (Admin only)',
    description:
      'Updates status of target user. Revokes sessions if suspended/disabled. Admin cannot disable self.',
  })
  @ApiResponse({
    status: 200,
    description: 'User status updated successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Admin cannot disable self or validation error.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async updateUserStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<SafeUserResponse> {
    return this.usersService.updateUserStatus(currentUser.id, id, dto);
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: 'Update user role (Admin only)',
    description:
      'Updates role of target user and revokes active sessions. Admin cannot change own role.',
  })
  @ApiResponse({ status: 200, description: 'User role updated successfully.' })
  @ApiResponse({
    status: 400,
    description: 'Admin cannot change own role or validation error.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async updateUserRole(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<SafeUserResponse> {
    return this.usersService.updateUserRole(currentUser.id, id, dto);
  }
}
