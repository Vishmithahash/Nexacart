-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'LLM_AGENT', 'SYSTEM');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
ADD COLUMN     "errorCode" VARCHAR(100),
ADD COLUMN     "ipAddress" VARCHAR(64),
ADD COLUMN     "qaRunId" VARCHAR(100),
ADD COLUMN     "success" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "toolCallId" VARCHAR(100),
ADD COLUMN     "userAgent" VARCHAR(500);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "refreshTokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refreshTokenHash_key" ON "auth_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "auth_sessions_revokedAt_idx" ON "auth_sessions"("revokedAt");

-- CreateIndex
CREATE INDEX "audit_logs_qaRunId_idx" ON "audit_logs"("qaRunId");

-- CreateIndex
CREATE INDEX "audit_logs_toolCallId_idx" ON "audit_logs"("toolCallId");

-- CreateIndex
CREATE INDEX "audit_logs_success_idx" ON "audit_logs"("success");

-- CreateIndex
CREATE INDEX "audit_logs_errorCode_idx" ON "audit_logs"("errorCode");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
