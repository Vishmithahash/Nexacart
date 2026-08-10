/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClockService } from '../common/clock/clock.service';
import { InventoryReservationStatus } from '../generated/prisma/client';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let prisma: any;

  const mockReservation = {
    id: 'res-123',
    cartId: 10,
    cartItemId: 100,
    productId: 1,
    quantity: 2,
    status: InventoryReservationStatus.ACTIVE,
    expiresAt: new Date(Date.now() - 1000), // due (expired 1 sec ago)
    releasedAt: null,
    releaseReason: null,
    product: {
      id: 1,
      stockQuantity: 100,
      reservedQuantity: 2,
    },
  };

  const mockPrismaService = {
    inventoryReservation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    product: {
      update: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
    },
    cart: {
      update: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockAuditService = {
    logInTransaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        ClockService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
    prisma = module.get(PrismaService);
    clockService = module.get<ClockService>(ClockService);
    jest.clearAllMocks();
  });

  describe('expireDueReservations', () => {
    it('should process due active reservations, release reserved stock, and record audit', async () => {
      prisma.inventoryReservation.findMany.mockResolvedValue([mockReservation]);
      prisma.inventoryReservation.findUnique.mockResolvedValue(mockReservation);

      const res = await service.expireDueReservations({ limit: 100 });

      expect(res.examined).toBe(1);
      expect(res.expired).toBe(1);
      expect(res.alreadyProcessed).toBe(0);

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { reservedQuantity: { decrement: 2 } },
        }),
      );

      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RELEASE',
            quantity: 2,
            reason: 'Controlled batch reservation expiry',
          }),
        }),
      );

      expect(prisma.inventoryReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'res-123' },
          data: expect.objectContaining({
            status: 'EXPIRED',
            releaseReason: 'RESERVATION_EXPIRED',
          }),
        }),
      );
    });

    it('should handle re-running when no due reservations exist', async () => {
      prisma.inventoryReservation.findMany.mockResolvedValue([]);

      const res = await service.expireDueReservations({ limit: 100 });

      expect(res.examined).toBe(0);
      expect(res.expired).toBe(0);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });
});
