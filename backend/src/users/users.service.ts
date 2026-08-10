import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UserRole, UserStatus } from '../generated/prisma/client';
import type { SafeUserResponse } from '../auth/auth.service';

const BCRYPT_SALT_ROUNDS = 12;

export interface PaginatedUsersResponse {
  data: SafeUserResponse[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getProfile(userId: number): Promise<SafeUserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw ApiException.userNotFound();
    }

    return user;
  }

  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
  ): Promise<SafeUserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw ApiException.userNotFound();
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName.trim() }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName.trim() }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'USER_PROFILE_UPDATED',
      entityType: 'User',
      entityId: String(userId),
      success: true,
      metadata: {
        updatedFields: Object.keys(dto),
      },
    });

    return updatedUser;
  }

  async changePassword(
    userId: number,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      throw ApiException.userNotFound();
    }

    const isCurrentValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isCurrentValid) {
      await this.auditService.log({
        userId,
        action: 'USER_PASSWORD_CHANGED_FAILED',
        entityType: 'User',
        entityId: String(userId),
        success: false,
        errorCode: 'VALIDATION_ERROR',
      });
      throw new ApiException(
        'VALIDATION_ERROR',
        'Current password is incorrect.',
        400,
      );
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new ApiException(
        'VALIDATION_ERROR',
        'New password must be different from current password.',
        400,
      );
    }

    const newPasswordHash = await bcrypt.hash(
      dto.newPassword,
      BCRYPT_SALT_ROUNDS,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      });

      // Revoke all active sessions upon password change
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.auditService.logInTransaction(
        {
          userId,
          action: 'USER_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: String(userId),
          success: true,
        },
        tx,
      );
    });

    return {
      message: 'Password changed successfully. Please log in again.',
    };
  }

  async listUsers(query: ListUsersQueryDto): Promise<PaginatedUsersResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.role) {
      where.role = query.role;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserById(id: number): Promise<SafeUserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw ApiException.userNotFound();
    }

    return user;
  }

  async updateUserStatus(
    adminId: number,
    targetUserId: number,
    dto: UpdateUserStatusDto,
  ): Promise<SafeUserResponse> {
    if (adminId === targetUserId) {
      throw new ApiException(
        'USER_CANNOT_DISABLE_SELF',
        'Admin cannot change their own account status.',
        400,
      );
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true },
    });

    if (!targetUser) {
      throw ApiException.userNotFound();
    }

    const previousStatus = targetUser.status;

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: { status: dto.status },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Revoke sessions if suspended or disabled
      if (dto.status !== UserStatus.ACTIVE) {
        await tx.authSession.updateMany({
          where: { userId: targetUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await this.auditService.logInTransaction(
        {
          userId: adminId,
          action: 'USER_STATUS_CHANGED',
          entityType: 'User',
          entityId: String(targetUserId),
          success: true,
          metadata: {
            targetUserId,
            previousStatus,
            newStatus: dto.status,
          },
        },
        tx,
      );

      return user;
    });

    return updatedUser;
  }

  async updateUserRole(
    adminId: number,
    targetUserId: number,
    dto: UpdateUserRoleDto,
  ): Promise<SafeUserResponse> {
    if (adminId === targetUserId) {
      throw new ApiException(
        'USER_CANNOT_CHANGE_OWN_ROLE',
        'Admin cannot change their own role.',
        400,
      );
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      throw ApiException.userNotFound();
    }

    const previousRole = targetUser.role;

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetUserId },
        data: { role: dto.role },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Revoke active sessions to force re-login with updated role JWT claims
      await tx.authSession.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.auditService.logInTransaction(
        {
          userId: adminId,
          action: 'USER_ROLE_CHANGED',
          entityType: 'User',
          entityId: String(targetUserId),
          success: true,
          metadata: {
            targetUserId,
            previousRole,
            newRole: dto.role,
          },
        },
        tx,
      );

      return user;
    });

    return updatedUser;
  }
}
