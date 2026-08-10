import { Test, TestingModule } from '@nestjs/testing';
import { StateConsistencyEvaluator } from './state-consistency.evaluator';
import { QaStateAssertionService } from '../state/qa-state-assertion.service';
import { QaTemplateResolverService } from '../fixtures/qa-template-resolver.service';
import { ExpectedStateAssertion, QaStateSnapshotContent } from '../state/qa-state.types';

describe('StateConsistencyEvaluator (Component 2)', () => {
  let evaluator: StateConsistencyEvaluator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateConsistencyEvaluator,
        QaStateAssertionService,
        QaTemplateResolverService,
      ],
    }).compile();

    evaluator = module.get<StateConsistencyEvaluator>(StateConsistencyEvaluator);
  });

  const mockBeforeSnapshot: QaStateSnapshotContent = {
    customer: { id: 1, email: 'qa@test.com' },
    cart: { itemCount: 0, totalQuantity: 0, items: {} },
    products: {
      targetProduct: {
        id: 100,
        stockQuantity: 10,
        reservedQuantity: 0,
        availableQuantity: 10,
        status: 'ACTIVE',
      },
    },
    orders: { count: 0 },
    payments: { count: 0, successfulTotal: '0.00' },
    refunds: { count: 0, successfulTotal: '0.00' },
    movements: { totalCount: 0, byType: { RESERVATION: 0, SALE: 0, CANCELLATION_RESTORE: 0 } },
  };

  const mockFixtureContext = {
    customerId: 1,
    customerEmail: 'qa@test.com',
    products: {},
  };

  it('evaluates correct state changes as passing', () => {
    const afterSnapshot: QaStateSnapshotContent = {
      ...mockBeforeSnapshot,
      cart: { itemCount: 1, totalQuantity: 2, items: {} },
      products: {
        targetProduct: {
          id: 100,
          stockQuantity: 10,
          reservedQuantity: 2,
          availableQuantity: 8,
          status: 'ACTIVE',
        },
      },
      movements: { totalCount: 1, byType: { RESERVATION: 1, SALE: 0, CANCELLATION_RESTORE: 0 } },
    };

    const assertions: ExpectedStateAssertion[] = [
      { path: 'cart.totalQuantity', operator: 'AFTER_EQUALS', value: 2 },
      { path: 'products.targetProduct.reservedQuantity', operator: 'DELTA_EQUALS', value: 2 },
      { path: 'products.targetProduct.stockQuantity', operator: 'UNCHANGED' },
    ];

    const res = evaluator.evaluate(
      mockBeforeSnapshot,
      afterSnapshot,
      assertions,
      100,
      mockFixtureContext,
    );

    expect(res.overallScore).toBe(100);
    expect(res.passed).toBe(true);
    expect(res.failedAssertions).toHaveLength(0);
  });

  it('fails when database state quantity is wrong (Component 2 failure)', () => {
    const afterSnapshot: QaStateSnapshotContent = {
      ...mockBeforeSnapshot,
      cart: { itemCount: 1, totalQuantity: 4, items: {} }, // 4 instead of 2
      products: {
        targetProduct: {
          id: 100,
          stockQuantity: 10,
          reservedQuantity: 4,
          availableQuantity: 6,
          status: 'ACTIVE',
        },
      },
    };

    const assertions: ExpectedStateAssertion[] = [
      { path: 'cart.totalQuantity', operator: 'AFTER_EQUALS', value: 2 },
    ];

    const res = evaluator.evaluate(
      mockBeforeSnapshot,
      afterSnapshot,
      assertions,
      100,
      mockFixtureContext,
    );

    expect(res.passed).toBe(false);
    expect(res.failedAssertions).toHaveLength(1);
  });

  it('fails when database invariant is violated (negative stock)', () => {
    const afterSnapshot: QaStateSnapshotContent = {
      ...mockBeforeSnapshot,
      products: {
        targetProduct: {
          id: 100,
          stockQuantity: -1, // Violated invariant!
          reservedQuantity: 0,
          availableQuantity: -1,
          status: 'ACTIVE',
        },
      },
    };

    const res = evaluator.evaluate(mockBeforeSnapshot, afterSnapshot, [], 100, mockFixtureContext);

    expect(res.invariantScore).toBeLessThan(100);
    expect(res.passed).toBe(false);
  });
});
