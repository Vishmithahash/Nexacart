-- Phase 7: Tool-Using LLM Agent Integration and Execution Tracing
-- Migration: add_llm_agent_tracing

-- ── 1. Create Enums ──────────────────────────────────────────────────────────
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'MAX_STEPS_REACHED');
CREATE TYPE "AgentToolCallStatus" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED', 'INVALID_ARGUMENTS');

-- ── 2. Extend refunds Table ──────────────────────────────────────────────────
ALTER TABLE "refunds" ADD COLUMN "requestHash" VARCHAR(64);

-- ── 3. Create agent_runs Table ───────────────────────────────────────────────
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "systemPromptVersion" VARCHAR(100) NOT NULL,
    "instruction" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "finalAnswer" TEXT,
    "providerResponseId" VARCHAR(200),
    "totalToolCalls" INTEGER NOT NULL DEFAULT 0,
    "usage" JSONB,
    "requestId" VARCHAR(100),
    "qaRunId" VARCHAR(100),
    "errorCode" VARCHAR(100),
    "errorMessage" VARCHAR(1000),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- ── 4. Create agent_tool_calls Table ─────────────────────────────────────────
CREATE TABLE "agent_tool_calls" (
    "id" UUID NOT NULL,
    "agentRunId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "providerCallId" VARCHAR(200),
    "toolName" VARCHAR(100) NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" "AgentToolCallStatus" NOT NULL,
    "result" JSONB,
    "errorCode" VARCHAR(100),
    "errorMessage" VARCHAR(1000),
    "durationMs" INTEGER,
    "requestId" VARCHAR(100),
    "qaRunId" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

-- ── 5. Create Indexes ────────────────────────────────────────────────────────
CREATE INDEX "agent_runs_userId_idx" ON "agent_runs"("userId");
CREATE INDEX "agent_runs_status_idx" ON "agent_runs"("status");
CREATE INDEX "agent_runs_qaRunId_idx" ON "agent_runs"("qaRunId");
CREATE INDEX "agent_runs_requestId_idx" ON "agent_runs"("requestId");
CREATE INDEX "agent_runs_startedAt_idx" ON "agent_runs"("startedAt");

CREATE INDEX "agent_tool_calls_agentRunId_idx" ON "agent_tool_calls"("agentRunId");
CREATE INDEX "agent_tool_calls_toolName_idx" ON "agent_tool_calls"("toolName");
CREATE INDEX "agent_tool_calls_status_idx" ON "agent_tool_calls"("status");
CREATE INDEX "agent_tool_calls_qaRunId_idx" ON "agent_tool_calls"("qaRunId");
CREATE INDEX "agent_tool_calls_createdAt_idx" ON "agent_tool_calls"("createdAt");
CREATE UNIQUE INDEX "agent_tool_calls_agentRunId_sequenceNumber_key" ON "agent_tool_calls"("agentRunId", "sequenceNumber");

-- ── 6. Foreign Keys ──────────────────────────────────────────────────────────
ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_tool_calls"
  ADD CONSTRAINT "agent_tool_calls_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 7. CHECK Constraints ─────────────────────────────────────────────────────
ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_total_tool_calls_non_negative" CHECK ("totalToolCalls" >= 0);

ALTER TABLE "agent_tool_calls"
  ADD CONSTRAINT "agent_tool_calls_sequence_number_positive" CHECK ("sequenceNumber" > 0),
  ADD CONSTRAINT "agent_tool_calls_duration_ms_non_negative" CHECK ("durationMs" IS NULL OR "durationMs" >= 0);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_request_hash_format" CHECK ("requestHash" IS NULL OR length("requestHash") = 64);
