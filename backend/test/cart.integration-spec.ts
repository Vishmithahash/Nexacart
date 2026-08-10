import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  CartStatus,
  InventoryReservationStatus,
  ProductStatus,
  UserRole,
  UserStatus,
} from '../src/generated/prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const SKIP_MESSAGE =
  '⚠️ TEST_DATABASE_URL is not set. Skipping real PostgreSQL integration tests. Set TEST_DATABASE_URL in .env (pointing to a test database, NOT nexacart) to run these tests.';

describe('Cart & Inventory & Checkout PostgreSQL Integration Tests', () => {
  const testDbUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient | null = null;

  beforeAll(async () => {
    if (!testDbUrl) {
      console.warn(SKIP_MESSAGE);
      return;
    }

    // Security guard: never run against the dev database
    if (testDbUrl.includes('/nexacart?') || testDbUrl.endsWith('/nexacart')) {
      throw new Error(
        'SECURITY GUARD: TEST_DATABASE_URL cannot point to the primary "nexacart" database. Point it to "nexacart_test".',
      );
    }

    const adapter = new PrismaPg({ connectionString: testDbUrl });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // ── Phase 4: Partial unique indexes ───────────────────────────────────────

  it('Phase 4: One ACTIVE cart per customer (partial unique index)', async () => {
    if (!testDbUrl || !prisma) {
      console.warn(SKIP_MESSAGE);
      expect(true).toBe(true);
      return;
    }

    await cleanTestData(prisma);

    const user = await prisma.user.create({
      data: buildUser('cart-unique@test.local'),
    });

    const cart = await prisma.cart.create({
      data: { userId: user.id, status: CartStatus.ACTIVE, version: 1 },
    });

    expect(cart.userId).toBe(user.id);

    // Second ACTIVE cart for same user must fail
    await expect(
      prisma.cart.create({
        data: { userId: user.id, status: CartStatus.ACTIVE, version: 1 },
      }),
    ).rejects.toThrow();

    // CONVERTED cart for same user is allowed
    const convertedCart = await prisma.cart.create({
      data: { userId: user.id, status: CartStatus.CONVERTED, version: 1 },
    });
    expect(convertedCart.status).toBe(CartStatus.CONVERTED);

    await cleanTestData(prisma);
  });

  // ── Phase 5: One order per cart (sourceCartId unique) ─────────────────────

  it('Phase 5: One order per source cart (unique sourceCartId)', async () => {
    if (!testDbUrl || !prisma) {
      console.warn(SKIP_MESSAGE);
      expect(true).toBe(true);
      return;
    }

    await cleanTestData(prisma);

    const user = await prisma.user.create({
      data: buildUser('order-unique@test.local'),
    });

    const cart = await prisma.cart.create({
      data: { userId: user.id, status: CartStatus.CONVERTED, version: 2 },
    });

    const order = await prisma.order.create({
      data: buildOrder(user.id, cart.id, 'NXC-TEST0001'),
    });

    expect(order.sourceCartId).toBe(cart.id);

    // Second order referencing same cart must fail (unique sourceCartId)
    await expect(
      prisma.order.create({
        data: buildOrder(user.id, cart.id, 'NXC-TEST0002'),
      }),
    ).rejects.toThrow();

    await cleanTestData(prisma);
  });

  // ── Phase 5: CHECK constraints on orders ──────────────────────────────────

  it('Phase 5: Order CHECK constraints reject invalid values', async () => {
    if (!testDbUrl || !prisma) {
      console.warn(SKIP_MESSAGE);
      expect(true).toBe(true);
      return;
    }

    await cleanTestData(prisma);

    const user = await prisma.user.create({
      data: buildUser('order-check@test.local'),
    });

    // Negative subtotal should fail
    await expect(
      prisma.order.create({
        data: {
          ...buildOrder(user.id, null, 'NXC-TEST0003'),
          subtotal: -1,
          totalAmount: -1,
        },
      }),
    ).rejects.toThrow();

    // Invalid currency code should fail
    await expect(
      prisma.order.create({
        data: {
          ...buildOrder(user.id, null, 'NXC-TEST0004'),
          currencyCode: 'lkr', // lowercase — invalid
        },
      }),
    ).rejects.toThrow();

    await cleanTestData(prisma);
  });

  // ── Phase 5: Reservation consumedAt lifecycle ─────────────────────────────

  it('Phase 5: InventoryReservation status transitions to CONSUMED', async () => {
    if (!testDbUrl || !prisma) {
      console.warn(SKIP_MESSAGE);
      expect(true).toBe(true);
      return;
    }

    await cleanTestData(prisma);

    const user = await prisma.user.create({
      data: buildUser('consumed-res@test.local'),
    });

    const category = await prisma.category.create({
      data: {
        name: 'Test Category',
        slug: 'test-cat-consumed',
        isActive: true,
      },
    });

    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: 'TEST-CONSUMED-001',
        name: 'Test Product',
        slug: 'test-product-consumed',
        price: '99.99',
        currencyCode: 'LKR',
        stockQuantity: 10,
        reservedQuantity: 2,
        status: ProductStatus.ACTIVE,
      },
    });

    const cart = await prisma.cart.create({
      data: { userId: user.id, status: CartStatus.ACTIVE, version: 1 },
    });

    const cartItem = await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity: 2,
        unitPrice: '99.99',
      },
    });

    const reservation = await prisma.inventoryReservation.create({
      data: {
        cartId: cart.id,
        cartItemId: cartItem.id,
        productId: product.id,
        quantity: 2,
        status: InventoryReservationStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    expect(reservation.status).toBe(InventoryReservationStatus.ACTIVE);
    expect(reservation.consumedAt).toBeNull();

    // Consume the reservation
    const consumedAt = new Date();
    const consumed = await prisma.inventoryReservation.update({
      where: { id: reservation.id },
      data: {
        status: InventoryReservationStatus.CONSUMED,
        consumedAt,
      },
    });

    expect(consumed.status).toBe(InventoryReservationStatus.CONSUMED);
    expect(consumed.consumedAt).not.toBeNull();

    await cleanTestData(prisma);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildUser(email: string) {
  return {
    email,
    passwordHash: 'dummyhash',
    firstName: 'Integration',
    lastName: 'Tester',
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
  };
}

function buildOrder(
  userId: number,
  sourceCartId: number | null,
  orderNumber: string,
) {
  return {
    orderNumber,
    userId,
    sourceCartId,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    shipmentStatus: 'NOT_READY',
    subtotal: '269.97',
    discountAmount: '0.00',
    shippingAmount: '0.00',
    totalAmount: '269.97',
    currencyCode: 'LKR',
    shippingAddress: {
      sourceAddressId: 1,
      fullName: 'Test Customer',
      phone: '+94771234567',
      addressLine1: '12 Main Road',
      addressLine2: null,
      city: 'Colombo',
      state: 'Western',
      postalCode: '00100',
      country: 'Sri Lanka',
    },
    placedAt: new Date(),
  };
}

async function cleanTestData(prisma: PrismaClient) {
  await prisma.inventoryReservation.deleteMany();
  await prisma.cartMutation.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.address.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.user.deleteMany();
}
