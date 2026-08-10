/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { AdminOrdersService } from './admin-orders.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminOrdersService', () => {
  let service: AdminOrdersService;
  let prisma: any;

  const mockOrder = {
    id: 1,
    orderNumber: 'NXC-ABCD1234',
    userId: 10,
    sourceCartId: 10,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    shipmentStatus: 'NOT_READY',
    subtotal: new Decimal('269.97'),
    discountAmount: new Decimal('0.00'),
    shippingAmount: new Decimal('0.00'),
    totalAmount: new Decimal('269.97'),
    currencyCode: 'LKR',
    shippingAddress: {
      sourceAddressId: 1,
      fullName: 'Test Customer',
      phone: '+94771234567',
      addressLine1: '12 Main Road',
      addressLine2: null,
      city: 'Colombo',
      state: 'Western Province',
      postalCode: '00100',
      country: 'Sri Lanka',
    },
    placedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 10,
      email: 'customer@nexacart.local',
      firstName: 'Test',
      lastName: 'Customer',
    },
    items: [
      {
        id: 1,
        productId: 1,
        sku: 'ELEC-WH-001',
        productName: 'Wireless Headphones',
        quantity: 3,
        unitPrice: new Decimal('89.99'),
        lineTotal: new Decimal('269.97'),
      },
    ],
  };

  const mockPrisma = {
    order: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOrdersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AdminOrdersService>(AdminOrdersService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('listOrders', () => {
    it('should return paginated orders with customer details for admin', async () => {
      prisma.order.findMany.mockResolvedValue([mockOrder]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.listOrders({
        page: 1,
        limit: 20,
        sort: 'newest',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].customer.email).toBe('customer@nexacart.local');
      expect(result.data[0].orderNumber).toBe('NXC-ABCD1234');
      expect(result.data[0].items[0].sku).toBe('ELEC-WH-001');
    });

    it('should filter by userId when provided', async () => {
      prisma.order.findMany.mockResolvedValue([mockOrder]);
      prisma.order.count.mockResolvedValue(1);

      await service.listOrders({
        page: 1,
        limit: 20,
        sort: 'newest',
        userId: 10,
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 10 }),
        }),
      );
    });

    it('should filter by status when provided', async () => {
      prisma.order.findMany.mockResolvedValue([mockOrder]);
      prisma.order.count.mockResolvedValue(1);

      await service.listOrders({
        page: 1,
        limit: 20,
        sort: 'newest',
        status: 'PENDING',
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });
  });

  describe('getOrderById', () => {
    it('should return detailed order with customer for admin', async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await service.getOrderById(1);

      expect(result.id).toBe(1);
      expect(result.customer.email).toBe('customer@nexacart.local');
      expect(result.subtotal).toBe('269.97');
    });

    it('should throw ORDER_NOT_FOUND when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.getOrderById(9999)).rejects.toMatchObject({
        errorCode: 'ORDER_NOT_FOUND',
      });
    });
  });
});
