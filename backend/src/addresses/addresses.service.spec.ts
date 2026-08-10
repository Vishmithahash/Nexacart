import { Test, TestingModule } from '@nestjs/testing';
import { AddressesService } from './addresses.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import { AddressType } from '../generated/prisma/client';

describe('AddressesService', () => {
  let service: AddressesService;
  let prisma: any;
  let auditService: any;

  const mockAddress = {
    id: 1,
    userId: 2,
    type: AddressType.SHIPPING,
    fullName: 'Test Customer',
    phone: '+94771234567',
    addressLine1: '12 Main Road',
    addressLine2: null,
    city: 'Colombo',
    state: null,
    postalCode: '00100',
    country: 'Sri Lanka',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAuditService = {
    log: jest.fn().mockResolvedValue(undefined),
    logInTransaction: jest.fn().mockResolvedValue(undefined),
  };

  const mockPrismaService = {
    address: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (cb) => cb(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
    prisma = module.get(PrismaService);
    auditService = module.get(AuditService);

    jest.clearAllMocks();
  });

  describe('createAddress', () => {
    it('should set first address of a type to default automatically', async () => {
      prisma.address.count
        .mockResolvedValueOnce(0) // total count < 10
        .mockResolvedValueOnce(0); // count of type === 0

      prisma.address.updateMany.mockResolvedValue({ count: 0 });
      prisma.address.create.mockResolvedValue({
        ...mockAddress,
        isDefault: true,
      });

      const dto = {
        type: AddressType.SHIPPING,
        fullName: 'Test Customer',
        phone: '+94771234567',
        addressLine1: '12 Main Road',
        city: 'Colombo',
        postalCode: '00100',
        country: 'Sri Lanka',
        isDefault: false,
      };

      const result = await service.createAddress(2, dto);

      expect(result.isDefault).toBe(true);
      expect(prisma.address.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isDefault: true }),
      });
    });

    it('should enforce 10 addresses per user limit', async () => {
      prisma.address.count.mockResolvedValueOnce(10);

      const dto = {
        type: AddressType.SHIPPING,
        fullName: 'Test Customer',
        phone: '+94771234567',
        addressLine1: '12 Main Road',
        city: 'Colombo',
        postalCode: '00100',
        country: 'Sri Lanka',
      };

      await expect(service.createAddress(2, dto as any)).rejects.toThrow(
        ApiException,
      );
    });
  });

  describe('ownership checks', () => {
    it('should return 404 when getting an address belonging to another user', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.getAddress(2, 999)).rejects.toThrow(ApiException);
    });

    it('should return 404 when updating an address belonging to another user', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.updateAddress(2, 999, {})).rejects.toThrow(
        ApiException,
      );
    });

    it('should return 404 when deleting an address belonging to another user', async () => {
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(service.deleteAddress(2, 999)).rejects.toThrow(ApiException);
    });
  });

  describe('deleteAddress default promotion', () => {
    it('should promote lowest-ID remaining address of same type when default is deleted', async () => {
      prisma.address.findFirst
        .mockResolvedValueOnce(mockAddress) // existing address to delete (isDefault: true)
        .mockResolvedValueOnce({
          id: 5,
          userId: 2,
          type: AddressType.SHIPPING,
          isDefault: false,
        }); // remaining lowest ID

      prisma.address.delete.mockResolvedValue({});
      prisma.address.update.mockResolvedValue({});

      const result = await service.deleteAddress(2, 1);

      expect(result.message).toBe('Address deleted successfully.');
      expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { isDefault: true },
      });
    });
  });
});
