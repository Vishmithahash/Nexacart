-- Phase 5 Lite: Minimal Checkout and Order Creation
-- Migration: add_minimal_checkout
-- Generated for NexaCart research project

-- ── 1. Extend CartMutationType enum ─────────────────────────────────────────
ALTER TYPE "CartMutationType" ADD VALUE 'CHECKOUT';

-- ── 2. Add consumedAt to InventoryReservation ────────────────────────────────
ALTER TABLE "inventory_reservations" ADD COLUMN "consumedAt" TIMESTAMP(3);

-- ── 3. Extend orders table ───────────────────────────────────────────────────
ALTER TABLE "orders"
  ADD COLUMN "sourceCartId" INTEGER,
  ADD COLUMN "currencyCode" CHAR(3) NOT NULL DEFAULT 'LKR',
  ADD COLUMN "placedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── 4. Unique constraint: one order per cart ─────────────────────────────────
CREATE UNIQUE INDEX "orders_sourceCartId_key" ON "orders"("sourceCartId");

-- ── 5. Index for admin queries ───────────────────────────────────────────────
CREATE INDEX "orders_sourceCartId_idx" ON "orders"("sourceCartId");

-- ── 6. Foreign key: orders → carts ──────────────────────────────────────────
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_sourceCartId_fkey"
  FOREIGN KEY ("sourceCartId") REFERENCES "carts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 7. CHECK constraints on orders ──────────────────────────────────────────
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_subtotal_non_negative"       CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "orders_discount_amount_non_negative" CHECK ("discountAmount" >= 0),
  ADD CONSTRAINT "orders_shipping_amount_non_negative" CHECK ("shippingAmount" >= 0),
  ADD CONSTRAINT "orders_total_amount_non_negative"   CHECK ("totalAmount" >= 0),
  ADD CONSTRAINT "orders_currency_code_format"        CHECK ("currencyCode" ~ '^[A-Z]{3}$');

-- ── 8. CHECK constraints on order_items ─────────────────────────────────────
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive"        CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_unit_price_non_negative"  CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "order_items_line_total_non_negative"  CHECK ("lineTotal" >= 0);
