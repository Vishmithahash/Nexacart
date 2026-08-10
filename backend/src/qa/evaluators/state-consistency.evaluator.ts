import { Injectable, Logger } from '@nestjs/common';
import { QaStateAssertionService } from '../state/qa-state-assertion.service';
import { ExpectedStateAssertion, QaStateSnapshotContent } from '../state/qa-state.types';
import { Component2EvaluationDetail } from './evaluator.types';
import { QaFixtureContext } from '../fixtures/qa-fixture-context.type';

@Injectable()
export class StateConsistencyEvaluator {
  private readonly logger = new Logger(StateConsistencyEvaluator.name);

  // Configurable weights for Component 2 sub-scores
  readonly weights = {
    assertions: 0.75,
    invariants: 0.25,
  };

  constructor(private readonly assertionService: QaStateAssertionService) {}

  evaluate(
    before: QaStateSnapshotContent,
    after: QaStateSnapshotContent,
    assertions: ExpectedStateAssertion[],
    passThreshold: number,
    fixtureContext: QaFixtureContext,
  ): Component2EvaluationDetail {
    // 1. Evaluate scenario-specific assertions (75%)
    const assertionRes = this.assertionService.evaluateAssertions(
      assertions,
      before,
      after,
      fixtureContext,
    );

    // 2. Evaluate built-in NexaCart database invariants (25%)
    const invariantRes = this.assertionService.evaluateInvariants(after);

    // Calculate Overall Component 2 Score
    const rawOverall =
      assertionRes.score * this.weights.assertions +
      invariantRes.score * this.weights.invariants;

    const overallScore = Math.round(rawOverall * 100) / 100;
    const passed = overallScore >= passThreshold && assertionRes.passed && invariantRes.passed;

    const passedAssertions = assertionRes.details.filter((d) => d.passed);
    const failedAssertions = assertionRes.details.filter((d) => !d.passed);

    return {
      stateAssertionScore: assertionRes.score,
      invariantScore: invariantRes.score,
      overallScore,
      passed,
      passedAssertions,
      failedAssertions,
      invariants: invariantRes.details,
    };
  }
}
