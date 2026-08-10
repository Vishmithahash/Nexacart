import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import { UserRole, UserStatus } from '../generated/prisma/client';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  let auditService: any;

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    passwordHash: '$2b$12$e/samplehash',
    firstName: 'Test',
    lastName: 'User',
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'REFRESH_TOKEN_TTL_DAYS') return '7';
      if (key === 'JWT_EXPIRES_IN') return '1d';
      return null;
    }),
    getOrThrow: jest
      .fn()
      .mockReturnValue('super-secret-jwt-key-32-chars-long!!'),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-access-token'),
  };

  const mockAuditService = {
    log: jest.fn().mockResolvedValue(undefined),
    logInTransaction: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    authSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (cb) => cb(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
    auditService = module.get(AuditService);

    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should successfully register a new user with normalized email', async () => {
      const { passwordHash, ...safeUser } = mockUser;
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(safeUser);
      prisma.authSession.create.mockResolvedValue({ id: 'session-uuid' });

      const dto = {
        email: '  NEWUSER@Example.COM  ',
        password: 'Password123',
        firstName: '  New  ',
        lastName: '  User  ',
      };

      const result = await service.register(dto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'newuser@example.com' },
        select: { id: true },
      });
      expect(result.user).toBeDefined();
      expect(result.user?.email).toBe('test@example.com');
      expect((result.user as any).passwordHash).toBeUndefined();
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw 409 when registering with duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 1 });

      const dto = {
        email: 'test@example.com',
        password: 'Password123',
        firstName: 'Test',
        lastName: 'User',
      };

      await expect(service.register(dto as any)).rejects.toThrow(ApiException);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_REGISTER_FAILED',
          errorCode: 'USER_EMAIL_EXISTS',
        }),
      );
    });
  });

  describe('login', () => {
    it('should authenticate user and return tokens when credentials are valid', async () => {
      const hashedPassword = await bcrypt.hash('Password123', 12);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hashedPassword,
      });
      prisma.authSession.create.mockResolvedValue({ id: 'session-uuid' });

      const result = await service.login({
        email: 'test@example.com',
        password: 'Password123',
      });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect((result.user as any).passwordHash).toBeUndefined();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTH_LOGIN_SUCCESS' }),
      );
    });

    it('should throw 401 generic error when password is wrong', async () => {
      const hashedPassword = await bcrypt.hash('Password123', 12);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hashedPassword,
      });

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'WrongPassword123',
        }),
      ).rejects.toThrow(ApiException);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_FAILED',
          errorCode: 'AUTH_INVALID_CREDENTIALS',
        }),
      );
    });

    it('should throw 401 when account is suspended', async () => {
      const hashedPassword = await bcrypt.hash('Password123', 12);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        status: UserStatus.SUSPENDED,
        passwordHash: hashedPassword,
      });

      await expect(
        service.login({
          email: 'test@example.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(ApiException);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGIN_FAILED',
          errorCode: 'AUTH_ACCOUNT_INACTIVE',
        }),
      );
    });
  });

  describe('refresh', () => {
    it('should rotate refresh token and return new token pair', async () => {
      const rawToken = 'raw-refresh-token';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      prisma.authSession.findUnique.mockResolvedValue({
        id: 'session-uuid',
        userId: 1,
        refreshTokenHash: tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        user: {
          id: 1,
          email: 'test@example.com',
          role: UserRole.CUSTOMER,
          status: UserStatus.ACTIVE,
        },
      });

      prisma.authSession.update.mockResolvedValue({});

      const result = await service.refresh({ refreshToken: rawToken });

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(prisma.authSession.update).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTH_REFRESH_SUCCESS' }),
      );
    });
  });

  describe('logout', () => {
    it('should revoke current session and return message', async () => {
      prisma.authSession.findUnique.mockResolvedValue({
        id: 'session-uuid',
        revokedAt: null,
      });
      prisma.authSession.update.mockResolvedValue({});

      const currentUser = {
        id: 1,
        email: 'test@example.com',
        role: UserRole.CUSTOMER,
        sessionId: 'session-uuid',
      };

      const result = await service.logout(currentUser);

      expect(result.message).toBe('Logged out successfully.');
      expect(prisma.authSession.update).toHaveBeenCalledWith({
        where: { id: 'session-uuid' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });

  describe('logoutAll', () => {
    it('should revoke all active sessions for user', async () => {
      prisma.authSession.updateMany.mockResolvedValue({ count: 3 });

      const currentUser = {
        id: 1,
        email: 'test@example.com',
        role: UserRole.CUSTOMER,
        sessionId: 'session-uuid',
      };

      const result = await service.logoutAll(currentUser);

      expect(result.revokedCount).toBe(3);
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 1, revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });
});
