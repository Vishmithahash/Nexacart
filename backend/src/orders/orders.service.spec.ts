/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OrdersService', () => {
  let service: OrdersService;
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
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('listMyOrders', () => {
    it('should return only the authenticated customer own orders', async () => {
      prisma.order.findMany.mockResolvedValue([mockOrder]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.listMyOrders(10, { page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].orderNumber).toBe('NXC-ABCD1234');
      expect(result.data[0].userId).toBe(10);
      expect(result.data[0].subtotal).toBe('269.97');

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 10 } }),
      );
    });

    it('should return empty list when customer has no orders', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      const result = await service.listMyOrders(10, { page: 1, limit: 20 });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.totalItems).toBe(0);
    });
  });

  describe('getMyOrderByOrderNumber', () => {
    it('should return the order when it belongs to the authenticated customer', async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrder);

      const result = await service.getMyOrderByOrderNumber(10, 'NXC-ABCD1234');

      expect(result.orderNumber).toBe('NXC-ABCD1234');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].sku).toBe('ELEC-WH-001');
    });

    it('should return 404 ORDER_NOT_FOUND when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.getMyOrderByOrderNumber(10, 'NXC-NONEXISTENT'),
      ).rejects.toMatchObject({ errorCode: 'ORDER_NOT_FOUND' });
    });

    it('should return same 404 when order belongs to another customer', async () => {
      // Order exists but belongs to userId=99 not 10
      prisma.order.findUnique.mockResolvedValue({ ...mockOrder, userId: 99 });

      await expect(
        service.getMyOrderByOrderNumber(10, 'NXC-ABCD1234'),
      ).rejects.toMatchObject({ errorCode: 'ORDER_NOT_FOUND' });
    });
  });
});
