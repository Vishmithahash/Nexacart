import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { ExpectedStateAssertion, QaStateSnapshotContent } from './qa-state.types';
import { QaTemplateResolverService } from '../fixtures/qa-template-resolver.service';
import { QaFixtureContext } from '../fixtures/qa-fixture-context.type';

export interface AssertionEvaluationDetail {
  path: string;
  operator: string;
  expected?: unknown;
  actual?: unknown;
  passed: boolean;
  explanation: string;
}

export interface InvariantEvaluationDetail {
  name: string;
  passed: boolean;
  explanation: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class QaStateAssertionService {
  private readonly logger = new Logger(QaStateAssertionService.name);

  constructor(private readonly templateResolver: QaTemplateResolverService) {}

  /**
   * Evaluate scenario state assertions against before/after snapshots.
   */
  evaluateAssertions(
    assertions: ExpectedStateAssertion[],
    before: QaStateSnapshotContent,
    after: QaStateSnapshotContent,
    fixtureContext: QaFixtureContext,
  ): {
    score: number;
    passed: boolean;
    details: AssertionEvaluationDetail[];
  } {
    if (!assertions || assertions.length === 0) {
      return { score: 100, passed: true, details: [] };
    }

    const details: AssertionEvaluationDetail[] = [];
    let passedCount = 0;

    for (const assertion of assertions) {
      const resolvedExpected = assertion.valueTemplate
        ? this.templateResolver.resolveJson(assertion.valueTemplate, fixtureContext)
        : assertion.value;

      const beforeVal = this.templateResolver.getValueByPath(before as any, assertion.path);
      const afterVal = this.templateResolver.getValueByPath(after as any, assertion.path);

      let isPassed = false;
      let explanation = '';

      switch (assertion.operator) {
        case 'AFTER_EQUALS': {
          isPassed = this.isEqual(afterVal, resolvedExpected);
          explanation = isPassed
            ? `After value at "${assertion.path}" equals expected (${String(resolvedExpected)}).`
            : `Expected "${assertion.path}" after value to be ${String(resolvedExpected)}, but got ${String(afterVal)}.`;
          break;
        }
        case 'AFTER_NOT_EQUALS': {
          isPassed = !this.isEqual(afterVal, resolvedExpected);
          explanation = isPassed
            ? `After value at "${assertion.path}" does not equal (${String(resolvedExpected)}).`
            : `Expected "${assertion.path}" after value not to be ${String(resolvedExpected)}.`;
          break;
        }
        case 'AFTER_EXISTS': {
          isPassed = afterVal !== undefined && afterVal !== null;
          explanation = isPassed
            ? `Path "${assertion.path}" exists in after snapshot.`
            : `Expected "${assertion.path}" to exist in after snapshot, but it was missing/null.`;
          break;
        }
        case 'AFTER_NOT_EXISTS': {
          isPassed = afterVal === undefined || afterVal === null;
          explanation = isPassed
            ? `Path "${assertion.path}" does not exist in after snapshot.`
            : `Expected "${assertion.path}" not to exist in after snapshot, but found ${String(afterVal)}.`;
          break;
        }
        case 'DELTA_EQUALS':
        case 'COUNT_DELTA_EQUALS': {
          const numBefore = this.toNumber(beforeVal);
          const numAfter = this.toNumber(afterVal);
          const expectedDelta = this.toNumber(resolvedExpected);
          const actualDelta = numAfter - numBefore;

          isPassed = Math.abs(actualDelta - expectedDelta) < 0.001;
          explanation = isPassed
            ? `Delta for "${assertion.path}" (${actualDelta}) equals expected delta (${expectedDelta}).`
            : `Expected delta for "${assertion.path}" to be ${expectedDelta}, but got ${actualDelta} (before=${numBefore}, after=${numAfter}).`;
          break;
        }
        case 'UNCHANGED': {
          isPassed = this.isEqual(beforeVal, afterVal);
          explanation = isPassed
            ? `Path "${assertion.path}" remained unchanged (${String(afterVal)}).`
            : `Expected "${assertion.path}" to remain unchanged, but changed from ${String(beforeVal)} to ${String(afterVal)}.`;
          break;
        }
        default: {
          isPassed = false;
          explanation = `Unknown assertion operator "${assertion.operator}".`;
        }
      }

      if (isPassed) passedCount++;

      details.push({
        path: assertion.path,
        operator: assertion.operator,
        expected: resolvedExpected,
        actual: afterVal,
        passed: isPassed,
        explanation,
      });
    }

    const score = Math.round((passedCount / assertions.length) * 10000) / 100;
    return {
      score,
      passed: passedCount === assertions.length,
      details,
    };
  }

  /**
   * Evaluate built-in NexaCart database invariants on the after snapshot.
   */
  evaluateInvariants(after: QaStateSnapshotContent): {
    score: number;
    passed: boolean;
    details: InvariantEvaluationDetail[];
  } {
    const details: InvariantEvaluationDetail[] = [];

    // Invariant 1: stockQuantity >= 0 for all products
    for (const [alias, prod] of Object.entries(after.products)) {
      const isPassed = prod.stockQuantity >= 0;
      details.push({
        name: `Product stock non-negative (${alias})`,
        passed: isPassed,
        explanation: isPassed
          ? `Product stock is non-negative (${prod.stockQuantity}).`
          : `Product "${alias}" has negative stockQuantity (${prod.stockQuantity}).`,
      });
    }

    // Invariant 2: reservedQuantity >= 0 for all products
    for (const [alias, prod] of Object.entries(after.products)) {
      const isPassed = prod.reservedQuantity >= 0;
      details.push({
        name: `Product reserved stock non-negative (${alias})`,
        passed: isPassed,
        explanation: isPassed
          ? `Product reserved stock is non-negative (${prod.reservedQuantity}).`
          : `Product "${alias}" has negative reservedQuantity (${prod.reservedQuantity}).`,
      });
    }

    // Invariant 3: reservedQuantity <= stockQuantity for all products
    for (const [alias, prod] of Object.entries(after.products)) {
      const isPassed = prod.reservedQuantity <= prod.stockQuantity;
      details.push({
        name: `Product reserved stock <= stockQuantity (${alias})`,
        passed: isPassed,
        explanation: isPassed
          ? `Reserved stock (${prod.reservedQuantity}) <= stockQuantity (${prod.stockQuantity}).`
          : `Product "${alias}" reservedQuantity (${prod.reservedQuantity}) exceeds stockQuantity (${prod.stockQuantity}).`,
      });
    }

    // Invariant 4: availableQuantity = stockQuantity - reservedQuantity
    for (const [alias, prod] of Object.entries(after.products)) {
      const expectedAvail = prod.stockQuantity - prod.reservedQuantity;
      const isPassed = prod.availableQuantity === expectedAvail;
      details.push({
        name: `Product availableQuantity calculation (${alias})`,
        passed: isPassed,
        explanation: isPassed
          ? `availableQuantity (${prod.availableQuantity}) equals stockQuantity - reservedQuantity.`
          : `Product "${alias}" availableQuantity (${prod.availableQuantity}) does not match stock - reserved (${expectedAvail}).`,
      });
    }

    // Invariant 5: Successful refunds total <= Paid payment total
    const paidDecimal = new Decimal(after.payments.successfulTotal || '0.00');
    const refundedDecimal = new Decimal(after.refunds.successfulTotal || '0.00');
    const refundInvariantPassed = refundedDecimal.lte(paidDecimal);
    details.push({
      name: 'Refunds <= Payments invariant',
      passed: refundInvariantPassed,
      explanation: refundInvariantPassed
        ? `Refund total (${refundedDecimal.toFixed(2)}) <= Paid total (${paidDecimal.toFixed(2)}).`
        : `Refund total (${refundedDecimal.toFixed(2)}) exceeds paid total (${paidDecimal.toFixed(2)}).`,
    });

    // Invariant 6: Cart item quantities > 0
    if (after.cart.items) {
      for (const [itemKey, item] of Object.entries(after.cart.items)) {
        const isPassed = item.quantity > 0;
        details.push({
          name: `Cart item quantity positive (${itemKey})`,
          passed: isPassed,
          explanation: isPassed
            ? `Cart item quantity is positive (${item.quantity}).`
            : `Cart item "${itemKey}" has invalid non-positive quantity (${item.quantity}).`,
        });
      }
    }

    const passedCount = details.filter((d) => d.passed).length;
    const total = details.length > 0 ? details.length : 1;
    const score = Math.round((passedCount / total) * 10000) / 100;

    return {
      score,
      passed: passedCount === total,
      details,
    };
  }

  private isEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return a === b;
    return String(a) === String(b);
  }

  private toNumber(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
}
