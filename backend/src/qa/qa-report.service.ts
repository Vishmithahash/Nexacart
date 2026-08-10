import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/exceptions/api.exception';
import { QaEvaluationComponent, QaSnapshotPhase } from '../generated/prisma/client';

@Injectable()
export class QaReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate an explainable, structured QA evaluation report for a QaRun.
   */
  async generateReport(runId: string) {
    const run = await this.prisma.qaRun.findUnique({
      where: { id: runId },
      include: {
        scenario: true,
        agentRun: { include: { toolCalls: { orderBy: { sequenceNumber: 'asc' } } } },
        snapshots: true,
        evaluations: true,
      },
    });

    if (!run) {
      throw ApiException.qaRunNotFound(runId);
    }

    const beforeSnap = run.snapshots.find((s) => s.phase === QaSnapshotPhase.BEFORE)?.snapshot;
    const afterSnap = run.snapshots.find((s) => s.phase === QaSnapshotPhase.AFTER)?.snapshot;

    const comp1Eval = run.evaluations.find(
      (e) => e.component === QaEvaluationComponent.TOOL_CALL_CORRECTNESS,
    );
    const comp2Eval = run.evaluations.find(
      (e) => e.component === QaEvaluationComponent.STATE_CONSISTENCY,
    );

    const actualToolTrace = run.agentRun?.toolCalls.map((c) => ({
      sequenceNumber: c.sequenceNumber,
      toolCallId: c.id,
      providerCallId: c.providerCallId,
      toolName: c.toolName,
      arguments: c.arguments,
      status: c.status,
      result: c.result,
      errorCode: c.errorCode,
      errorMessage: c.errorMessage,
      durationMs: c.durationMs,
    })) || [];

    return {
      correlation: {
        qaRunId: run.id,
        agentRunId: run.agentRunId,
        scenarioCode: run.scenario.code,
        scenarioVersion: run.scenarioVersion,
      },
      metadata: {
        scenarioName: run.scenario.name,
        scenarioDescription: run.scenario.description,
        instructionTemplate: run.scenario.instructionTemplate,
        resolvedInstruction: run.resolvedInstruction,
        provider: run.provider,
        model: run.model,
        systemPromptVersion: run.systemPromptVersion,
        status: run.status,
        overallPassed: run.overallPassed,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
      agentResult: {
        finalAnswer: run.agentRun?.finalAnswer,
        totalToolCalls: run.agentRun?.totalToolCalls ?? 0,
        toolTrace: actualToolTrace,
      },
      component1_toolCallCorrectness: comp1Eval
        ? {
            score: Number(comp1Eval.score),
            passed: comp1Eval.passed,
            summary: comp1Eval.summary,
            details: comp1Eval.details,
          }
        : null,
      component2_stateConsistency: comp2Eval
        ? {
            score: Number(comp2Eval.score),
            passed: comp2Eval.passed,
            summary: comp2Eval.summary,
            details: comp2Eval.details,
          }
        : null,
      stateSnapshots: {
        before: beforeSnap ?? null,
        after: afterSnap ?? null,
      },
    };
  }
}
