export interface ExpectedToolStep {
  tool: string;
  arguments?: Record<string, { operator: string; value?: unknown; valueTemplate?: string }>;
}

export interface ExpectedToolPlan {
  requiredSteps: ExpectedToolStep[];
  allowedExtraReadTools?: string[];
  forbiddenTools?: string[];
  maxStateChangingCalls?: number;
}

export interface Component1EvaluationDetail {
  toolSelectionScore: number; // 30%
  parameterAccuracyScore: number; // 30%
  sequenceScore: number; // 25%
  safetyScore: number; // 15%
  overallScore: number;
  passed: boolean;
  matchedSteps: Array<{ sequenceNumber: number; tool: string }>;
  missingSteps: string[];
  argumentFailures: Array<{
    sequenceNumber: number;
    tool: string;
    argument: string;
    expected: unknown;
    actual: unknown;
    explanation: string;
  }>;
  forbiddenCalls: Array<{ sequenceNumber: number; tool: string }>;
  repeatedCalls: Array<{ sequenceNumber: number; tool: string }>;
}

export interface Component2EvaluationDetail {
  stateAssertionScore: number; // 75%
  invariantScore: number; // 25%
  overallScore: number;
  passed: boolean;
  passedAssertions: unknown[];
  failedAssertions: unknown[];
  invariants: unknown[];
}
