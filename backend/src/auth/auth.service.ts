import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UserRole, UserStatus } from '../generated/prisma/client';
import type { AuthenticatedUser } from './types/authenticated-user.type';
import type { JwtPayload } from './types/jwt-payload.type';

const BCRYPT_SALT_ROUNDS = 12;

export interface SafeUserResponse {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AuthTokensResponse {
  user?: SafeUserResponse;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly refreshTokenTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {
    this.refreshTokenTtlDays = parseInt(
      this.configService.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? '7',
      10,
    );
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private generateRawRefreshToken(): string {
    return randomBytes(32).toString('hex');
  }

  private getSessionExpiryDate(): Date {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenTtlDays);
    return expiresAt;
  }

  async register(dto: RegisterDto): Promise<AuthTokensResponse> {
    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      await this.auditService.log({
        action: 'AUTH_REGISTER_FAILED',
        entityType: 'User',
        entityId: email,
        success: false,
        errorCode: 'USER_EMAIL_EXISTS',
        metadata: { email },
      });
      throw ApiException.emailExists();
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    const rawRefreshToken = this.generateRawRefreshToken();
    const refreshTokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = this.getSessionExpiryDate();

    // Use Prisma transaction to atomically create user + session + audit log
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          role: UserRole.CUSTOMER, // Registrations always receive CUSTOMER role
          status: UserStatus.ACTIVE,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
        },
      });

      const session = await tx.authSession.create({
        data: {
          userId: user.id,
          refreshTokenHash,
          expiresAt,
        },
        select: { id: true },
      });

      await this.auditService.logInTransaction(
        {
          userId: user.id,
          action: 'AUTH_REGISTER_SUCCESS',
          entityType: 'User',
          entityId: String(user.id),
          success: true,
          metadata: { email: user.email, role: user.role },
        },
        tx,
      );

      return { user, sessionId: session.id };
    });

    const payload: JwtPayload = {
      sub: result.user.id,
      email: result.user.email,
      role: result.user.role,
      sessionId: result.sessionId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      user: result.user,
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async login(dto: LoginDto): Promise<AuthTokensResponse> {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      await this.auditService.log({
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: email,
        success: false,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        metadata: { email }, // Never include password
      });
      throw ApiException.invalidCredentials();
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatch) {
      await this.auditService.log({
        userId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: String(user.id),
        success: false,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        metadata: { email }, // Never include password
      });
      throw ApiException.invalidCredentials();
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.auditService.log({
        userId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'User',
        entityId: String(user.id),
        success: false,
        errorCode: 'AUTH_ACCOUNT_INACTIVE',
        metadata: { status: user.status },
      });
      throw ApiException.accountInactive();
    }

    const rawRefreshToken = this.generateRawRefreshToken();
    const refreshTokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = this.getSessionExpiryDate();

    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt,
      },
      select: { id: true },
    });

    await this.auditService.log({
      userId: user.id,
      action: 'AUTH_LOGIN_SUCCESS',
      entityType: 'User',
      entityId: String(user.id),
      success: true,
      metadata: { email: user.email, role: user.role },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async refresh(dto: RefreshTokenDto): Promise<AuthTokensResponse> {
    const incomingHash = this.hashToken(dto.refreshToken);

    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: incomingHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!session) {
      await this.auditService.log({
        action: 'AUTH_REFRESH_FAILED',
        entityType: 'AuthSession',
        entityId: 'unknown',
        success: false,
        errorCode: 'AUTH_SESSION_INVALID',
      });
      throw ApiException.sessionInvalid();
    }

    if (session.revokedAt) {
      await this.auditService.log({
        userId: session.userId,
        action: 'AUTH_REFRESH_FAILED',
        entityType: 'AuthSession',
        entityId: session.id,
        success: false,
        errorCode: 'AUTH_SESSION_REVOKED',
      });
      throw ApiException.sessionRevoked();
    }

    if (session.expiresAt < new Date()) {
      await this.auditService.log({
        userId: session.userId,
        action: 'AUTH_REFRESH_FAILED',
        entityType: 'AuthSession',
        entityId: session.id,
        success: false,
        errorCode: 'AUTH_SESSION_EXPIRED',
      });
      throw ApiException.sessionExpired();
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      await this.auditService.log({
        userId: session.userId,
        action: 'AUTH_REFRESH_FAILED',
        entityType: 'User',
        entityId: String(session.userId),
        success: false,
        errorCode: 'AUTH_ACCOUNT_INACTIVE',
      });
      throw ApiException.accountInactive();
    }

    // Refresh Token Rotation: Replace old refresh token hash with new hash
    const newRawRefreshToken = this.generateRawRefreshToken();
    const newRefreshTokenHash = this.hashToken(newRawRefreshToken);
    const newExpiresAt = this.getSessionExpiryDate();

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: newExpiresAt,
      },
    });

    await this.auditService.log({
      userId: session.userId,
      action: 'AUTH_REFRESH_SUCCESS',
      entityType: 'AuthSession',
      entityId: session.id,
      success: true,
    });

    const payload: JwtPayload = {
      sub: session.user.id,
      email: session.user.email,
      role: session.user.role,
      sessionId: session.id,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  async logout(currentUser: AuthenticatedUser): Promise<{ message: string }> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: currentUser.sessionId },
      select: { id: true, revokedAt: true },
    });

    if (session && !session.revokedAt) {
      await this.prisma.authSession.update({
        where: { id: currentUser.sessionId },
        data: { revokedAt: new Date() },
      });
    }

    await this.auditService.log({
      userId: currentUser.id,
      action: 'AUTH_LOGOUT',
      entityType: 'AuthSession',
      entityId: currentUser.sessionId,
      success: true,
    });

    return { message: 'Logged out successfully.' };
  }

  async logoutAll(
    currentUser: AuthenticatedUser,
  ): Promise<{ message: string; revokedCount: number }> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId: currentUser.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await this.auditService.log({
      userId: currentUser.id,
      action: 'AUTH_LOGOUT_ALL',
      entityType: 'User',
      entityId: String(currentUser.id),
      success: true,
      metadata: { revokedCount: result.count },
    });

    return {
      message: 'All sessions logged out successfully.',
      revokedCount: result.count,
    };
  }

  async getMe(userId: number): Promise<SafeUserResponse> {
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
}
