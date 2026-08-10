/**
 * NexaCart Development Seed
 *
 * Idempotent — safe to run multiple times.
 * Uses upsert to avoid duplicate records.
 *
 * SECURITY NOTE:
 * - Passwords are hashed with bcrypt (rounds: 12)
 * - Password hashes are never printed
 * - DATABASE_URL is never printed
 *
 * Phase 3 additions:
 * - Products seeded with currencyCode, version, lowStockThreshold
 * - Baseline INITIAL_STOCK movements created with deterministic idempotencyKey
 * - Running seed twice does not duplicate categories, products, or movements
 */

import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  UserRole,
  UserStatus,
  ProductStatus,
  InventoryMovementType,
} from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const BCRYPT_ROUNDS = 12;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  console.log('🌱 Starting NexaCart seed...');

  try {
    // ── Users ───────────────────────────────────────────────────────────────

    const adminPasswordHash = await bcrypt.hash(
      'Admin@NexaCart2025',
      BCRYPT_ROUNDS,
    );
    const customerPasswordHash = await bcrypt.hash(
      'Customer@NexaCart2025',
      BCRYPT_ROUNDS,
    );

    const adminUser = await prisma.user.upsert({
      where: { email: 'admin@nexacart.local' },
      update: {},
      create: {
        email: 'admin@nexacart.local',
        passwordHash: adminPasswordHash,
        firstName: 'NexaCart',
        lastName: 'Admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    console.log(`✅ Admin user: ${adminUser.email}`);

    const customerUser = await prisma.user.upsert({
      where: { email: 'customer@nexacart.local' },
      update: {},
      create: {
        email: 'customer@nexacart.local',
        passwordHash: customerPasswordHash,
        firstName: 'Test',
        lastName: 'Customer',
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });
    console.log(`✅ Customer user: ${customerUser.email}`);

    // ── Categories ──────────────────────────────────────────────────────────

    const electronics = await prisma.category.upsert({
      where: { slug: 'electronics' },
      update: {},
      create: {
        name: 'Electronics',
        slug: 'electronics',
        description: 'Electronic devices, gadgets, and accessories',
        isActive: true,
      },
    });
    console.log(`✅ Category: ${electronics.name}`);

    const fashion = await prisma.category.upsert({
      where: { slug: 'fashion' },
      update: {},
      create: {
        name: 'Fashion',
        slug: 'fashion',
        description: 'Clothing, footwear, and accessories',
        isActive: true,
      },
    });
    console.log(`✅ Category: ${fashion.name}`);

    const homeAndLiving = await prisma.category.upsert({
      where: { slug: 'home-and-living' },
      update: {},
      create: {
        name: 'Home and Living',
        slug: 'home-and-living',
        description: 'Furniture, décor, and household essentials',
        isActive: true,
      },
    });
    console.log(`✅ Category: ${homeAndLiving.name}`);

    // ── Products ────────────────────────────────────────────────────────────
    // Phase 3: includes currencyCode, version, lowStockThreshold

    const wirelessHeadphones = await prisma.product.upsert({
      where: { sku: 'ELEC-WH-001' },
      update: {
        currencyCode: 'LKR',
        lowStockThreshold: 10,
      },
      create: {
        categoryId: electronics.id,
        sku: 'ELEC-WH-001',
        name: 'Wireless Headphones',
        slug: 'wireless-headphones',
        description:
          'Premium over-ear wireless headphones with active noise cancellation, 30-hour battery life, and foldable design.',
        price: '89.99',
        currencyCode: 'LKR',
        stockQuantity: 150,
        reservedQuantity: 0,
        lowStockThreshold: 10,
        version: 1,
        status: ProductStatus.ACTIVE,
        imageUrls: [],
      },
    });
    console.log(`✅ Product: ${wirelessHeadphones.name}`);

    const mechanicalKeyboard = await prisma.product.upsert({
      where: { sku: 'ELEC-MK-002' },
      update: {
        currencyCode: 'LKR',
        lowStockThreshold: 5,
      },
      create: {
        categoryId: electronics.id,
        sku: 'ELEC-MK-002',
        name: 'Mechanical Keyboard',
        slug: 'mechanical-keyboard',
        description:
          'Compact TKL mechanical keyboard with Cherry MX Blue switches, RGB backlighting, and USB-C connectivity.',
        price: '129.00',
        currencyCode: 'LKR',
        stockQuantity: 75,
        reservedQuantity: 0,
        lowStockThreshold: 5,
        version: 1,
        status: ProductStatus.ACTIVE,
        imageUrls: [],
      },
    });
    console.log(`✅ Product: ${mechanicalKeyboard.name}`);

    const smartWatch = await prisma.product.upsert({
      where: { sku: 'ELEC-SW-003' },
      update: {
        currencyCode: 'LKR',
        lowStockThreshold: 5,
      },
      create: {
        categoryId: electronics.id,
        sku: 'ELEC-SW-003',
        name: 'Smart Watch',
        slug: 'smart-watch',
        description:
          'Multi-sport smartwatch with heart rate monitoring, GPS, sleep tracking, and 7-day battery life.',
        price: '199.99',
        currencyCode: 'LKR',
        stockQuantity: 60,
        reservedQuantity: 0,
        lowStockThreshold: 5,
        version: 1,
        status: ProductStatus.ACTIVE,
        imageUrls: [],
      },
    });
    console.log(`✅ Product: ${smartWatch.name}`);

    const cottonTShirt = await prisma.product.upsert({
      where: { sku: 'FASH-CT-001' },
      update: {
        currencyCode: 'LKR',
        lowStockThreshold: 20,
      },
      create: {
        categoryId: fashion.id,
        sku: 'FASH-CT-001',
        name: 'Cotton T-Shirt',
        slug: 'cotton-t-shirt',
        description:
          'Classic 100% organic cotton unisex t-shirt, available in multiple colours. Soft, breathable, and durable.',
        price: '24.99',
        currencyCode: 'LKR',
        stockQuantity: 300,
        reservedQuantity: 0,
        lowStockThreshold: 20,
        version: 1,
        status: ProductStatus.ACTIVE,
        imageUrls: [],
      },
    });
    console.log(`✅ Product: ${cottonTShirt.name}`);

    const deskLamp = await prisma.product.upsert({
      where: { sku: 'HOME-DL-001' },
      update: {
        currencyCode: 'LKR',
        lowStockThreshold: 5,
      },
      create: {
        categoryId: homeAndLiving.id,
        sku: 'HOME-DL-001',
        name: 'Desk Lamp',
        slug: 'desk-lamp',
        description:
          'Adjustable LED desk lamp with 5 brightness levels, touch dimmer, USB charging port, and flexible gooseneck arm.',
        price: '44.50',
        currencyCode: 'LKR',
        stockQuantity: 120,
        reservedQuantity: 0,
        lowStockThreshold: 5,
        version: 1,
        status: ProductStatus.ACTIVE,
        imageUrls: [],
      },
    });
    console.log(`✅ Product: ${deskLamp.name}`);

    // ── Baseline INITIAL_STOCK movements ─────────────────────────────────────
    // Created only once per product using a deterministic idempotencyKey.
    // Running the seed twice will not create duplicate movement records.

    const seededProducts = [
      wirelessHeadphones,
      mechanicalKeyboard,
      smartWatch,
      cottonTShirt,
      deskLamp,
    ];

    let movementsCreated = 0;
    let movementsSkipped = 0;

    for (const product of seededProducts) {
      const idempotencyKey = `seed-initial-stock-${product.sku}`;

      const existing = await prisma.inventoryMovement.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });

      if (existing) {
        movementsSkipped++;
        continue;
      }

      await prisma.inventoryMovement.create({
        data: {
          productId: product.id,
          actorUserId: null,
          type: InventoryMovementType.INITIAL_STOCK,
          quantity: product.stockQuantity,
          stockBefore: 0,
          stockAfter: product.stockQuantity,
          reservedBefore: 0,
          reservedAfter: 0,
          reason: 'Baseline seed stock',
          idempotencyKey,
          metadata: { source: 'seed-baseline' },
        },
      });
      movementsCreated++;
    }

    console.log(`✅ Inventory movements: ${movementsCreated} created, ${movementsSkipped} skipped (already exist)`);

    console.log('\n🎉 Seed completed successfully.');
    console.log(`   Users:               2`);
    console.log(`   Categories:          3`);
    console.log(`   Products:            5`);
    console.log(`   Initial movements:   ${movementsCreated} created, ${movementsSkipped} skipped`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Seed failed:', error.message);
  process.exit(1);
});
