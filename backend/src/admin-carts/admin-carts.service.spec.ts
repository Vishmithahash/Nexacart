/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { AdminCartsService } from './admin-carts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../common/clock/clock.service';
import {
  CartStatus,
  InventoryReservationStatus,
} from '../generated/prisma/client';

describe('AdminCartsService', () => {
  let service: AdminCartsService;
  let prisma: any;

  const mockCart = {
    id: 10,
    userId: 1,
    status: CartStatus.ACTIVE,
    version: 1,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 1,
      email: 'customer@nexacart.local',
      firstName: 'Test',
      lastName: 'Customer',
    },
    items: [
      {
        id: 100,
        productId: 1,
        quantity: 2,
        unitPrice: new Decimal('89.99'),
        createdAt: new Date(),
        updatedAt: new Date(),
        product: {
          id: 1,
          sku: 'ELEC-WH-001',
          name: 'Wireless Headphones',
          price: new Decimal('89.99'),
          currencyCode: 'LKR',
          stockQuantity: 100,
          reservedQuantity: 2,
        },
        reservations: [
          {
            id: 'res-1',
            quantity: 2,
            status: InventoryReservationStatus.ACTIVE,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            releasedAt: null,
            releaseReason: null,
          },
        ],
      },
    ],
  };

  const mockPrismaService = {
    cart: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCartsService,
        ClockService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AdminCartsService>(AdminCartsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('listCarts', () => {
    it('should list customer carts for admin inspection with customer details', async () => {
      prisma.cart.findMany.mockResolvedValue([mockCart]);
      prisma.cart.count.mockResolvedValue(1);

      const res = await service.listCarts({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].customer.email).toBe('customer@nexacart.local');
      expect(res.data[0].items[0].sku).toBe('ELEC-WH-001');
    });
  });

  describe('getCartById', () => {
    it('should return detailed customer cart by ID for admin', async () => {
      prisma.cart.findUnique.mockResolvedValue(mockCart);

      const res = await service.getCartById(10);

      expect(res.id).toBe(10);
      expect(res.customer.id).toBe(1);
      expect(res.summary.subtotal).toBe('179.98');
    });
  });
});
