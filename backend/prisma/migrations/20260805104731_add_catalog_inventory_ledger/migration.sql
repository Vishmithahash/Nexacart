-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('INITIAL_STOCK', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RESERVATION', 'RELEASE', 'SALE', 'RETURN', 'CORRECTION');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "currencyCode" CHAR(3) NOT NULL DEFAULT 'LKR',
ADD COLUMN     "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "reservedBefore" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "reason" VARCHAR(500),
    "referenceType" VARCHAR(50),
    "referenceId" VARCHAR(100),
    "idempotencyKey" VARCHAR(100),
    "requestId" VARCHAR(100),
    "qaRunId" VARCHAR(100),
    "toolCallId" VARCHAR(100),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_idempotencyKey_key" ON "inventory_movements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "inventory_movements_productId_idx" ON "inventory_movements"("productId");

-- CreateIndex
CREATE INDEX "inventory_movements_actorUserId_idx" ON "inventory_movements"("actorUserId");

-- CreateIndex
CREATE INDEX "inventory_movements_type_idx" ON "inventory_movements"("type");

-- CreateIndex
CREATE INDEX "inventory_movements_createdAt_idx" ON "inventory_movements"("createdAt");

-- CreateIndex
CREATE INDEX "inventory_movements_requestId_idx" ON "inventory_movements"("requestId");

-- CreateIndex
CREATE INDEX "inventory_movements_qaRunId_idx" ON "inventory_movements"("qaRunId");

-- CreateIndex
CREATE INDEX "inventory_movements_toolCallId_idx" ON "inventory_movements"("toolCallId");

-- CreateIndex
CREATE INDEX "inventory_movements_referenceType_referenceId_idx" ON "inventory_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "products_slug_idx" ON "products"("slug");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraints: products
ALTER TABLE "products"
  ADD CONSTRAINT "products_price_non_negative" CHECK ("price" >= 0),
  ADD CONSTRAINT "products_stock_quantity_non_negative" CHECK ("stockQuantity" >= 0),
  ADD CONSTRAINT "products_reserved_quantity_non_negative" CHECK ("reservedQuantity" >= 0),
  ADD CONSTRAINT "products_reserved_not_exceeds_stock" CHECK ("reservedQuantity" <= "stockQuantity"),
  ADD CONSTRAINT "products_low_stock_threshold_non_negative" CHECK ("lowStockThreshold" >= 0),
  ADD CONSTRAINT "products_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "products_currency_code_three_chars" CHECK (char_length("currencyCode") = 3);

-- AddCheckConstraints: inventory_movements
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "inventory_movements_stock_before_non_negative" CHECK ("stockBefore" >= 0),
  ADD CONSTRAINT "inventory_movements_stock_after_non_negative" CHECK ("stockAfter" >= 0),
  ADD CONSTRAINT "inventory_movements_reserved_before_non_negative" CHECK ("reservedBefore" >= 0),
  ADD CONSTRAINT "inventory_movements_reserved_after_non_negative" CHECK ("reservedAfter" >= 0),
  ADD CONSTRAINT "inventory_movements_reserved_before_not_exceeds_stock_before" CHECK ("reservedBefore" <= "stockBefore"),
  ADD CONSTRAINT "inventory_movements_reserved_after_not_exceeds_stock_after" CHECK ("reservedAfter" <= "stockAfter");
