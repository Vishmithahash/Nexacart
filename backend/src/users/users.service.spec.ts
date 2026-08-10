import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import { UserRole, UserStatus } from '../generated/prisma/client';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let auditService: any;

  const mockUser = {
    id: 2,
    email: 'customer@nexacart.local',
    passwordHash: '$2b$12$e/samplehash',
    firstName: 'Test',
    lastName: 'Customer',
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAuditService = {
    log: jest.fn().mockResolvedValue(undefined),
    logInTransaction: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    authSession: {
      updateMany: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (cb) => cb(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
    auditService = module.get(AuditService);

    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should return safe user profile without passwordHash', async () => {
      const safeProfile = {
        id: 2,
        email: 'customer@nexacart.local',
        firstName: 'Test',
        lastName: 'Customer',
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.user.findUnique.mockResolvedValue(safeProfile);

      const result = await service.getProfile(2);

      expect(result).toBeDefined();
      expect(result.id).toBe(2);
      expect((result as any).passwordHash).toBeUndefined();
    });

    it('should throw 404 if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile(999)).rejects.toThrow(ApiException);
    });
  });

  describe('updateProfile', () => {
    it('should update first and last name and return safe user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 2 });
      prisma.user.update.mockResolvedValue({
        id: 2,
        email: 'customer@nexacart.local',
        firstName: 'Updated',
        lastName: 'Name',
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      });

      const result = await service.updateProfile(2, {
        firstName: 'Updated',
        lastName: 'Name',
      });

      expect(result.firstName).toBe('Updated');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'USER_PROFILE_UPDATED' }),
      );
    });
  });

  describe('changePassword', () => {
    it('should verify current password and revoke all active sessions', async () => {
      const oldHash = await bcrypt.hash('OldPassword123', 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        passwordHash: oldHash,
      });
      prisma.user.update.mockResolvedValue({});
      prisma.authSession.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.changePassword(2, {
        currentPassword: 'OldPassword123',
        newPassword: 'NewPassword123',
      });

      expect(result.message).toContain('Password changed successfully');
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 2, revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });

    it('should fail if current password is incorrect', async () => {
      const oldHash = await bcrypt.hash('OldPassword123', 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        passwordHash: oldHash,
      });

      await expect(
        service.changePassword(2, {
          currentPassword: 'WrongPassword123',
          newPassword: 'NewPassword123',
        }),
      ).rejects.toThrow(ApiException);
    });
  });

  describe('admin operations', () => {
    it('should list users with pagination', async () => {
      prisma.user.findMany.mockResolvedValue([mockUser]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should prevent admin from disabling self', async () => {
      await expect(
        service.updateUserStatus(1, 1, { status: UserStatus.SUSPENDED }),
      ).rejects.toThrow(ApiException);
    });

    it('should prevent admin from changing own role', async () => {
      await expect(
        service.updateUserRole(1, 1, { role: UserRole.CUSTOMER }),
      ).rejects.toThrow(ApiException);
    });
  });
});
