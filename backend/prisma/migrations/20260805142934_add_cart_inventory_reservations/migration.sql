-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "CartMutationType" AS ENUM ('ADD_ITEM', 'UPDATE_ITEM', 'REMOVE_ITEM', 'CLEAR_CART', 'RESERVE_ITEM', 'EXPIRE_RESERVATIONS');

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "cartId" INTEGER NOT NULL,
    "cartItemId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" VARCHAR(100),
    "requestId" VARCHAR(100),
    "qaRunId" VARCHAR(100),
    "toolCallId" VARCHAR(100),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_mutations" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "cartId" INTEGER,
    "type" "CartMutationType" NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "requestId" VARCHAR(100),
    "qaRunId" VARCHAR(100),
    "toolCallId" VARCHAR(100),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_reservations_cartId_idx" ON "inventory_reservations"("cartId");

-- CreateIndex
CREATE INDEX "inventory_reservations_cartItemId_idx" ON "inventory_reservations"("cartItemId");

-- CreateIndex
CREATE INDEX "inventory_reservations_productId_idx" ON "inventory_reservations"("productId");

-- CreateIndex
CREATE INDEX "inventory_reservations_status_idx" ON "inventory_reservations"("status");

-- CreateIndex
CREATE INDEX "inventory_reservations_expiresAt_idx" ON "inventory_reservations"("expiresAt");

-- CreateIndex
CREATE INDEX "inventory_reservations_requestId_idx" ON "inventory_reservations"("requestId");

-- CreateIndex
CREATE INDEX "inventory_reservations_qaRunId_idx" ON "inventory_reservations"("qaRunId");

-- CreateIndex
CREATE INDEX "inventory_reservations_toolCallId_idx" ON "inventory_reservations"("toolCallId");

-- CreateIndex
CREATE INDEX "cart_mutations_cartId_idx" ON "cart_mutations"("cartId");

-- CreateIndex
CREATE INDEX "cart_mutations_requestId_idx" ON "cart_mutations"("requestId");

-- CreateIndex
CREATE INDEX "cart_mutations_qaRunId_idx" ON "cart_mutations"("qaRunId");

-- CreateIndex
CREATE INDEX "cart_mutations_toolCallId_idx" ON "cart_mutations"("toolCallId");

-- CreateIndex
CREATE INDEX "cart_mutations_createdAt_idx" ON "cart_mutations"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cart_mutations_userId_type_idempotencyKey_key" ON "cart_mutations"("userId", "type", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_cartItemId_fkey" FOREIGN KEY ("cartItemId") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_mutations" ADD CONSTRAINT "cart_mutations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_mutations" ADD CONSTRAINT "cart_mutations_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Expression Indexes (Phase 3 Preflight) ──────────────────────────────────
CREATE UNIQUE INDEX "categories_lower_name_idx" ON "categories" (LOWER("name"));
CREATE UNIQUE INDEX "categories_lower_slug_idx" ON "categories" (LOWER("slug"));
CREATE UNIQUE INDEX "products_lower_slug_idx" ON "products" (LOWER("slug"));

-- ── Partial Unique Indexes (Phase 4 Database Invariants) ─────────────────────
-- Enforce at most one ACTIVE cart per user
CREATE UNIQUE INDEX "carts_one_active_cart_per_user_idx" ON "carts" ("userId") WHERE "status" = 'ACTIVE';

-- Enforce at most one ACTIVE reservation per cart item
CREATE UNIQUE INDEX "inventory_reservations_one_active_per_cart_item_idx" ON "inventory_reservations" ("cartItemId") WHERE "status" = 'ACTIVE';

-- ── Strengthen Currency Constraint (Phase 3 Preflight) ──────────────────────
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_currency_code_three_chars";
ALTER TABLE "products" ADD CONSTRAINT "products_currency_code_uppercase_alpha" CHECK ("currencyCode" ~ '^[A-Z]{3}$');

-- ── CHECK Constraints (Phase 4 Database Invariants) ─────────────────────────
-- Carts
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_version_positive" CHECK ("version" > 0);

-- Cart Items
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "cart_items_unit_price_non_negative" CHECK ("unitPrice" >= 0);

-- Inventory Reservations
ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "inventory_reservations_expires_after_created" CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "inventory_reservations_released_at_null_when_active" CHECK ("status" != 'ACTIVE' OR "releasedAt" IS NULL);

-- Cart Mutations
ALTER TABLE "cart_mutations"
  ADD CONSTRAINT "cart_mutations_idempotency_key_not_blank" CHECK (char_length(trim("idempotencyKey")) > 0),
  ADD CONSTRAINT "cart_mutations_request_hash_exact_64" CHECK (char_length("requestHash") = 64),
  ADD CONSTRAINT "cart_mutations_valid_response_status" CHECK ("responseStatus" IS NULL OR ("responseStatus" >= 100 AND "responseStatus" <= 599));

