-- Phase 8: QA Framework Core (Scenarios, Tool-Call Correctness, State Consistency)
-- Migration: add_qa_framework_core

-- ── 1. Create Enums ──────────────────────────────────────────────────────────
CREATE TYPE "QaRunStatus" AS ENUM ('PREPARING', 'RUNNING_AGENT', 'EVALUATING', 'COMPLETED', 'FAILED');
CREATE TYPE "QaEvaluationComponent" AS ENUM ('TOOL_CALL_CORRECTNESS', 'STATE_CONSISTENCY');
CREATE TYPE "QaSnapshotPhase" AS ENUM ('BEFORE', 'AFTER');

-- ── 2. Create qa_scenarios Table ─────────────────────────────────────────────
CREATE TABLE "qa_scenarios" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "instructionTemplate" TEXT NOT NULL,
    "fixtureDefinition" JSONB NOT NULL,
    "expectedToolPlan" JSONB NOT NULL,
    "expectedStateAssertions" JSONB NOT NULL,
    "toolPassThreshold" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "statePassThreshold" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_scenarios_pkey" PRIMARY KEY ("id")
);

-- ── 3. Create qa_runs Table ──────────────────────────────────────────────────
CREATE TABLE "qa_runs" (
    "id" UUID NOT NULL,
    "scenarioId" UUID NOT NULL,
    "scenarioVersion" INTEGER NOT NULL,
    "status" "QaRunStatus" NOT NULL,
    "agentRunId" UUID,
    "resolvedInstruction" TEXT NOT NULL,
    "fixtureContext" JSONB NOT NULL,
    "provider" VARCHAR(50),
    "model" VARCHAR(100),
    "systemPromptVersion" VARCHAR(100),
    "toolCorrectnessScore" DECIMAL(5,2),
    "stateConsistencyScore" DECIMAL(5,2),
    "toolPassed" BOOLEAN,
    "statePassed" BOOLEAN,
    "overallPassed" BOOLEAN,
    "errorCode" VARCHAR(100),
    "errorMessage" VARCHAR(1000),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "qa_runs_pkey" PRIMARY KEY ("id")
);

-- ── 4. Create qa_state_snapshots Table ───────────────────────────────────────
CREATE TABLE "qa_state_snapshots" (
    "id" UUID NOT NULL,
    "qaRunId" UUID NOT NULL,
    "phase" "QaSnapshotPhase" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_state_snapshots_pkey" PRIMARY KEY ("id")
);

-- ── 5. Create qa_evaluation_results Table ───────────────────────────────────
CREATE TABLE "qa_evaluation_results" (
    "id" UUID NOT NULL,
    "qaRunId" UUID NOT NULL,
    "component" "QaEvaluationComponent" NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "details" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_evaluation_results_pkey" PRIMARY KEY ("id")
);

-- ── 6. Create Indexes ────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "qa_scenarios_code_key" ON "qa_scenarios"("code");
CREATE INDEX "qa_scenarios_code_idx" ON "qa_scenarios"("code");
CREATE INDEX "qa_scenarios_isActive_idx" ON "qa_scenarios"("isActive");

CREATE UNIQUE INDEX "qa_runs_agentRunId_key" ON "qa_runs"("agentRunId");
CREATE INDEX "qa_runs_scenarioId_idx" ON "qa_runs"("scenarioId");
CREATE INDEX "qa_runs_status_idx" ON "qa_runs"("status");
CREATE INDEX "qa_runs_agentRunId_idx" ON "qa_runs"("agentRunId");
CREATE INDEX "qa_runs_startedAt_idx" ON "qa_runs"("startedAt");

CREATE INDEX "qa_state_snapshots_qaRunId_idx" ON "qa_state_snapshots"("qaRunId");
CREATE UNIQUE INDEX "qa_state_snapshots_qaRunId_phase_key" ON "qa_state_snapshots"("qaRunId", "phase");

CREATE INDEX "qa_evaluation_results_qaRunId_idx" ON "qa_evaluation_results"("qaRunId");
CREATE INDEX "qa_evaluation_results_component_idx" ON "qa_evaluation_results"("component");
CREATE INDEX "qa_evaluation_results_passed_idx" ON "qa_evaluation_results"("passed");
CREATE UNIQUE INDEX "qa_evaluation_results_qaRunId_component_key" ON "qa_evaluation_results"("qaRunId", "component");

-- ── 7. Foreign Keys ──────────────────────────────────────────────────────────
ALTER TABLE "qa_runs"
  ADD CONSTRAINT "qa_runs_scenarioId_fkey"
  FOREIGN KEY ("scenarioId") REFERENCES "qa_scenarios"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "qa_runs"
  ADD CONSTRAINT "qa_runs_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qa_state_snapshots"
  ADD CONSTRAINT "qa_state_snapshots_qaRunId_fkey"
  FOREIGN KEY ("qaRunId") REFERENCES "qa_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qa_evaluation_results"
  ADD CONSTRAINT "qa_evaluation_results_qaRunId_fkey"
  FOREIGN KEY ("qaRunId") REFERENCES "qa_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 8. CHECK Constraints ─────────────────────────────────────────────────────
ALTER TABLE "qa_scenarios"
  ADD CONSTRAINT "qa_scenarios_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "qa_scenarios_tool_pass_threshold_range" CHECK ("toolPassThreshold" >= 0 AND "toolPassThreshold" <= 100),
  ADD CONSTRAINT "qa_scenarios_state_pass_threshold_range" CHECK ("statePassThreshold" >= 0 AND "statePassThreshold" <= 100);

ALTER TABLE "qa_evaluation_results"
  ADD CONSTRAINT "qa_evaluation_results_score_range" CHECK ("score" >= 0 AND "score" <= 100);
