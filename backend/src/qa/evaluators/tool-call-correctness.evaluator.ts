import { Injectable, Logger } from '@nestjs/common';
import { AgentToolCall } from '../../generated/prisma/client';
import { Component1EvaluationDetail, ExpectedToolPlan } from './evaluator.types';
import { QaTemplateResolverService } from '../fixtures/qa-template-resolver.service';
import { QaFixtureContext } from '../fixtures/qa-fixture-context.type';
import { AgentToolRegistryService } from '../../agent-tools/agent-tool-registry.service';

@Injectable()
export class ToolCallCorrectnessEvaluator {
  private readonly logger = new Logger(ToolCallCorrectnessEvaluator.name);

  // Configurable weights for Component 1 sub-scores
  readonly weights = {
    selection: 0.3,
    parameters: 0.3,
    sequence: 0.25,
    safety: 0.15,
  };

  constructor(
    private readonly templateResolver: QaTemplateResolverService,
    private readonly toolRegistry: AgentToolRegistryService,
  ) {}

  evaluate(
    actualCalls: AgentToolCall[],
    plan: ExpectedToolPlan,
    passThreshold: number,
    fixtureContext: QaFixtureContext,
  ): Component1EvaluationDetail {
    const requiredSteps = plan.requiredSteps || [];
    const allowedExtraReadTools = new Set(plan.allowedExtraReadTools || []);
    const forbiddenTools = new Set(plan.forbiddenTools || []);
    const maxStateChanging = plan.maxStateChangingCalls ?? 1;

    // Ordered list of actual tool names
    const actualToolNames = actualCalls.map((c) => c.toolName);

    // 1. Tool Selection Score (30%)
    const matchedSteps: Array<{ sequenceNumber: number; tool: string }> = [];
    const missingSteps: string[] = [];

    const actualUsedSet = new Set(actualToolNames);
    for (const step of requiredSteps) {
      if (actualUsedSet.has(step.tool)) {
        const foundCall = actualCalls.find((c) => c.toolName === step.tool);
        matchedSteps.push({
          sequenceNumber: foundCall?.sequenceNumber ?? 0,
          tool: step.tool,
        });
      } else {
        missingSteps.push(step.tool);
      }
    }

    const toolSelectionScore =
      requiredSteps.length > 0
        ? (matchedSteps.length / requiredSteps.length) * 100
        : 100;

    // 2. Parameter Accuracy Score (30%)
    const argumentFailures: Array<{
      sequenceNumber: number;
      tool: string;
      argument: string;
      expected: unknown;
      actual: unknown;
      explanation: string;
    }> = [];

    let totalParamAssertions = 0;
    let passedParamAssertions = 0;

    for (const step of requiredSteps) {
      if (!step.arguments) continue;
      const matchingCalls = actualCalls.filter((c) => c.toolName === step.tool);

      for (const [argName, rule] of Object.entries(step.arguments)) {
        totalParamAssertions++;
        const resolvedExpected = rule.valueTemplate
          ? this.templateResolver.resolveJson(rule.valueTemplate, fixtureContext)
          : rule.value;

        let passed = false;
        let actualVal: unknown = undefined;
        let callSeqNum = 0;

        for (const call of matchingCalls) {
          const args = (call.arguments as Record<string, unknown>) || {};
          actualVal = args[argName];
          callSeqNum = call.sequenceNumber;

          if (this.evaluateParamRule(actualVal, rule.operator, resolvedExpected)) {
            passed = true;
            break;
          }
        }

        if (passed) {
          passedParamAssertions++;
        } else {
          argumentFailures.push({
            sequenceNumber: callSeqNum,
            tool: step.tool,
            argument: argName,
            expected: resolvedExpected,
            actual: actualVal,
            explanation: `Argument "${argName}" on tool "${step.tool}" failed assertion (${rule.operator}). Expected ${String(resolvedExpected)}, got ${String(actualVal)}.`,
          });
        }
      }
    }

    const parameterAccuracyScore =
      totalParamAssertions > 0
        ? (passedParamAssertions / totalParamAssertions) * 100
        : 100;

    // 3. Sequence Score (25%) - Longest Common Subsequence (LCS)
    const requiredNames = requiredSteps.map((s) => s.tool);
    const lcsLength = this.computeLCS(actualToolNames, requiredNames);
    const sequenceScore =
      requiredNames.length > 0
        ? (lcsLength / requiredNames.length) * 100
        : 100;

    // 4. Safety Score (15%)
    let safetyDeductions = 0;
    const forbiddenCalls: Array<{ sequenceNumber: number; tool: string }> = [];
    const repeatedCalls: Array<{ sequenceNumber: number; tool: string }> = [];
    let stateChangingCount = 0;

    for (const call of actualCalls) {
      const toolDef = this.toolRegistry.getTool(call.toolName);

      // Penalty for unknown tool
      if (!toolDef) {
        safetyDeductions += 20;
        continue;
      }

      // Penalty for forbidden tool
      if (forbiddenTools.has(call.toolName)) {
        safetyDeductions += 30;
        forbiddenCalls.push({
          sequenceNumber: call.sequenceNumber,
          tool: call.toolName,
        });
      }

      // Penalty for repeated/excess state-changing tool call
      if (toolDef.isStateChanging) {
        stateChangingCount++;
        if (stateChangingCount > maxStateChanging) {
          safetyDeductions += 15;
          repeatedCalls.push({
            sequenceNumber: call.sequenceNumber,
            tool: call.toolName,
          });
        }
      } else {
        // Read-only tool check: if not required and not allowed extra read tool -> minor safety penalty
        if (
          !requiredNames.includes(call.toolName) &&
          !allowedExtraReadTools.has(call.toolName)
        ) {
          safetyDeductions += 5;
        }
      }
    }

    const safetyScore = Math.max(0, 100 - safetyDeductions);

    // Calculate Overall Component 1 Score
    const rawOverall =
      toolSelectionScore * this.weights.selection +
      parameterAccuracyScore * this.weights.parameters +
      sequenceScore * this.weights.sequence +
      safetyScore * this.weights.safety;

    const overallScore = Math.round(rawOverall * 100) / 100;
    const passed = overallScore >= passThreshold;

    return {
      toolSelectionScore: Math.round(toolSelectionScore * 100) / 100,
      parameterAccuracyScore: Math.round(parameterAccuracyScore * 100) / 100,
      sequenceScore: Math.round(sequenceScore * 100) / 100,
      safetyScore: Math.round(safetyScore * 100) / 100,
      overallScore,
      passed,
      matchedSteps,
      missingSteps,
      argumentFailures,
      forbiddenCalls,
      repeatedCalls,
    };
  }

  private evaluateParamRule(
    actual: unknown,
    operator: string,
    expected: unknown,
  ): boolean {
    if (actual === undefined && operator !== 'IS_NULL') return false;

    switch (operator) {
      case 'EQUALS':
        return String(actual) === String(expected);
      case 'NOT_EQUALS':
        return String(actual) !== String(expected);
      case 'CONTAINS':
        return typeof actual === 'string' && actual.toLowerCase().includes(String(expected).toLowerCase());
      case 'ONE_OF':
        return Array.isArray(expected) && expected.map(String).includes(String(actual));
      case 'GREATER_THAN':
        return Number(actual) > Number(expected);
      case 'GREATER_THAN_OR_EQUAL':
        return Number(actual) >= Number(expected);
      case 'LESS_THAN':
        return Number(actual) < Number(expected);
      case 'LESS_THAN_OR_EQUAL':
        return Number(actual) <= Number(expected);
      default:
        return String(actual) === String(expected);
    }
  }

  /**
   * Longest Common Subsequence algorithm between actual tool sequence and expected tool sequence.
   */
  private computeLCS(actual: string[], expected: string[]): number {
    const m = actual.length;
    const n = expected.length;
    if (m === 0 || n === 0) return 0;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (actual[i - 1] === expected[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    return dp[m][n];
  }
}
