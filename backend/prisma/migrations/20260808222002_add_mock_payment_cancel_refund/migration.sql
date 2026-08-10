-- Phase 6 Lite: Mock Payment, Order Cancellation and Refund
-- Migration: add_mock_payment_cancel_refund

-- ── 1. Create Enums ──────────────────────────────────────────────────────────
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('SUCCEEDED', 'FAILED');
CREATE TYPE "RefundStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- ── 2. Extend InventoryMovementType Enum ────────────────────────────────────
ALTER TYPE "InventoryMovementType" ADD VALUE 'CANCELLATION_RESTORE';

-- ── 3. Extend orders Table ───────────────────────────────────────────────────
ALTER TABLE "orders"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" INTEGER,
  ADD COLUMN "cancelIdempotencyKey" VARCHAR(100),
  ADD COLUMN "cancelRequestHash" VARCHAR(64);

-- ── 4. Create payment_attempts Table ─────────────────────────────────────────
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "orderId" INTEGER NOT NULL,
    "paymentId" INTEGER,
    "status" "PaymentAttemptStatus" NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionReference" VARCHAR(150),
    "failureReason" VARCHAR(500),
    "requestId" VARCHAR(100),
    "qaRunId" VARCHAR(100),
    "toolCallId" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- ── 5. Create refunds Table ──────────────────────────────────────────────────
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "orderId" INTEGER NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500),
    "transactionReference" VARCHAR(150),
    "failureReason" VARCHAR(500),
    "requestId" VARCHAR(100),
    "qaRunId" VARCHAR(100),
    "toolCallId" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- ── 6. Create Indexes ────────────────────────────────────────────────────────
CREATE INDEX "payment_attempts_orderId_idx" ON "payment_attempts"("orderId");
CREATE INDEX "payment_attempts_paymentId_idx" ON "payment_attempts"("paymentId");
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts"("status");
CREATE INDEX "payment_attempts_requestId_idx" ON "payment_attempts"("requestId");
CREATE INDEX "payment_attempts_qaRunId_idx" ON "payment_attempts"("qaRunId");
CREATE INDEX "payment_attempts_toolCallId_idx" ON "payment_attempts"("toolCallId");
CREATE INDEX "payment_attempts_createdAt_idx" ON "payment_attempts"("createdAt");
CREATE UNIQUE INDEX "payment_attempts_orderId_idempotencyKey_key" ON "payment_attempts"("orderId", "idempotencyKey");

CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");
CREATE INDEX "refunds_status_idx" ON "refunds"("status");
CREATE INDEX "refunds_requestId_idx" ON "refunds"("requestId");
CREATE INDEX "refunds_qaRunId_idx" ON "refunds"("qaRunId");
CREATE INDEX "refunds_toolCallId_idx" ON "refunds"("toolCallId");
CREATE INDEX "refunds_createdAt_idx" ON "refunds"("createdAt");
CREATE UNIQUE INDEX "refunds_orderId_idempotencyKey_key" ON "refunds"("orderId", "idempotencyKey");

CREATE UNIQUE INDEX "orders_cancelIdempotencyKey_key" ON "orders"("cancelIdempotencyKey");

-- ── 7. Foreign Keys ──────────────────────────────────────────────────────────
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 8. CHECK Constraints ─────────────────────────────────────────────────────
ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payment_attempts_idempotency_key_not_empty" CHECK (length(trim("idempotencyKey")) > 0);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "refunds_idempotency_key_not_empty" CHECK (length(trim("idempotencyKey")) > 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cancel_request_hash_format" CHECK ("cancelRequestHash" IS NULL OR length("cancelRequestHash") = 64);
