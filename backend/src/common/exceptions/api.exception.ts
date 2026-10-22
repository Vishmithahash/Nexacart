import { HttpException, HttpStatus } from '@nestjs/common';
import type { AppErrorCode } from '../types/app-error-code.type';

/**
 * Structured business exception that carries a stable error code.
 * The global ApiExceptionFilter extracts errorCode from the response body.
 */
export class ApiException extends HttpException {
  public readonly errorCode: string;

  constructor(errorCode: AppErrorCode, message: string, statusCode: number) {
    super({ errorCode, message }, statusCode);
    this.errorCode = errorCode;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  static invalidCredentials(): ApiException {
    return new ApiException(
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  static accountInactive(): ApiException {
    return new ApiException(
      'AUTH_ACCOUNT_INACTIVE',
      'Your account is inactive. Please contact support.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  static tokenInvalid(): ApiException {
    return new ApiException(
      'AUTH_TOKEN_INVALID',
      'Access token is missing or invalid.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  static sessionInvalid(): ApiException {
    return new ApiException(
      'AUTH_SESSION_INVALID',
      'Session not found.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  static sessionExpired(): ApiException {
    return new ApiException(
      'AUTH_SESSION_EXPIRED',
      'Session has expired. Please log in again.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  static sessionRevoked(): ApiException {
    return new ApiException(
      'AUTH_SESSION_REVOKED',
      'Session has been revoked. Please log in again.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  static forbidden(): ApiException {
    return new ApiException(
      'AUTH_FORBIDDEN',
      'You do not have permission to perform this action.',
      HttpStatus.FORBIDDEN,
    );
  }

  // ── Users ────────────────────────────────────────────────────────────────

  static emailExists(): ApiException {
    return new ApiException(
      'USER_EMAIL_EXISTS',
      'An account with this email address already exists.',
      HttpStatus.CONFLICT,
    );
  }

  static userNotFound(): ApiException {
    return new ApiException(
      'USER_NOT_FOUND',
      'User not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  // ── Addresses ────────────────────────────────────────────────────────────

  static addressNotFound(): ApiException {
    return new ApiException(
      'ADDRESS_NOT_FOUND',
      'Address not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static addressLimitReached(): ApiException {
    return new ApiException(
      'ADDRESS_LIMIT_REACHED',
      'You have reached the maximum of 10 addresses.',
      HttpStatus.BAD_REQUEST,
    );
  }

  // ── Categories ───────────────────────────────────────────────────────────

  static categoryNotFound(): ApiException {
    return new ApiException(
      'CATEGORY_NOT_FOUND',
      'Category not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static categoryNameExists(): ApiException {
    return new ApiException(
      'CATEGORY_NAME_EXISTS',
      'A category with this name already exists.',
      HttpStatus.CONFLICT,
    );
  }

  static categorySlugExists(): ApiException {
    return new ApiException(
      'CATEGORY_SLUG_EXISTS',
      'A category with this slug already exists.',
      HttpStatus.CONFLICT,
    );
  }

  static categoryInactive(): ApiException {
    return new ApiException(
      'CATEGORY_INACTIVE',
      'Category is inactive.',
      HttpStatus.CONFLICT,
    );
  }

  static categoryHasActiveProducts(): ApiException {
    return new ApiException(
      'CATEGORY_HAS_ACTIVE_PRODUCTS',
      'Cannot deactivate a category that contains active products. Deactivate the products first.',
      HttpStatus.CONFLICT,
    );
  }

  // ── Products ─────────────────────────────────────────────────────────────

  static productNotFound(): ApiException {
    return new ApiException(
      'PRODUCT_NOT_FOUND',
      'Product not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static productSkuExists(): ApiException {
    return new ApiException(
      'PRODUCT_SKU_EXISTS',
      'A product with this SKU already exists.',
      HttpStatus.CONFLICT,
    );
  }

  static productSlugExists(): ApiException {
    return new ApiException(
      'PRODUCT_SLUG_EXISTS',
      'A product with this slug already exists.',
      HttpStatus.CONFLICT,
    );
  }

  static productInactive(): ApiException {
    return new ApiException(
      'PRODUCT_INACTIVE',
      'Product is not active.',
      HttpStatus.NOT_FOUND,
    );
  }

  static productCategoryInactive(): ApiException {
    return new ApiException(
      'PRODUCT_CATEGORY_INACTIVE',
      'Cannot activate a product under an inactive category.',
      HttpStatus.CONFLICT,
    );
  }

  static productVersionConflict(): ApiException {
    return new ApiException(
      'PRODUCT_VERSION_CONFLICT',
      'The product was modified by another request. Fetch the latest version and retry.',
      HttpStatus.CONFLICT,
    );
  }

  static productHasReservedStock(): ApiException {
    return new ApiException(
      'PRODUCT_HAS_RESERVED_STOCK',
      'Cannot change product status while it has reserved stock.',
      HttpStatus.CONFLICT,
    );
  }

  static productPriceInvalid(): ApiException {
    return new ApiException(
      'PRODUCT_PRICE_INVALID',
      'Price must be a non-negative decimal string with at most two decimal places.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static productNotAvailable(message?: string): ApiException {
    return new ApiException(
      'PRODUCT_NOT_AVAILABLE',
      message || 'Product is not available for cart addition.',
      HttpStatus.CONFLICT,
    );
  }

  // ── Inventory ────────────────────────────────────────────────────────────

  static inventoryAdjustmentInvalid(message: string): ApiException {
    return new ApiException(
      'INVENTORY_ADJUSTMENT_INVALID',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  static inventoryInsufficientStock(): ApiException {
    return new ApiException(
      'INVENTORY_INSUFFICIENT_STOCK',
      'Insufficient stock for this adjustment.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static inventoryIdempotencyConflict(): ApiException {
    return new ApiException(
      'INVENTORY_IDEMPOTENCY_CONFLICT',
      'Idempotency key reused with different parameters.',
      HttpStatus.CONFLICT,
    );
  }

  static inventoryMovementNotFound(): ApiException {
    return new ApiException(
      'INVENTORY_MOVEMENT_NOT_FOUND',
      'Inventory movement not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  // ── Cart & Reservations (Phase 4) ────────────────────────────────────────

  static cartNotFound(): ApiException {
    return new ApiException(
      'CART_NOT_FOUND',
      'Cart not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static cartItemNotFound(): ApiException {
    return new ApiException(
      'CART_ITEM_NOT_FOUND',
      'Cart item not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static cartItemLimitReached(limit: number): ApiException {
    return new ApiException(
      'CART_ITEM_LIMIT_REACHED',
      `Cart cannot exceed ${limit} distinct items.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  static cartItemQuantityInvalid(message: string): ApiException {
    return new ApiException(
      'CART_ITEM_QUANTITY_INVALID',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  static cartVersionConflict(): ApiException {
    return new ApiException(
      'CART_VERSION_CONFLICT',
      'The cart was modified by another request. Fetch the latest version and retry.',
      HttpStatus.CONFLICT,
    );
  }

  static cartIdempotencyKeyRequired(): ApiException {
    return new ApiException(
      'CART_IDEMPOTENCY_KEY_REQUIRED',
      'X-Idempotency-Key header is required for state-changing cart operations.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static cartIdempotencyConflict(): ApiException {
    return new ApiException(
      'CART_IDEMPOTENCY_CONFLICT',
      'Idempotency key reused with different request parameters.',
      HttpStatus.CONFLICT,
    );
  }

  static reservationNotFound(): ApiException {
    return new ApiException(
      'RESERVATION_NOT_FOUND',
      'Reservation not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static reservationExpired(): ApiException {
    return new ApiException(
      'RESERVATION_EXPIRED',
      'Reservation has expired.',
      HttpStatus.CONFLICT,
    );
  }

  static reservationAlreadyReleased(): ApiException {
    return new ApiException(
      'RESERVATION_ALREADY_RELEASED',
      'Reservation has already been released.',
      HttpStatus.CONFLICT,
    );
  }

  static reservationInsufficientStock(): ApiException {
    return new ApiException(
      'RESERVATION_INSUFFICIENT_STOCK',
      'Insufficient available stock to reserve item.',
      HttpStatus.CONFLICT,
    );
  }

  // ── Checkout (Phase 5) ────────────────────────────────────────────────────

  static checkoutCartNotFound(): ApiException {
    return new ApiException(
      'CHECKOUT_CART_NOT_FOUND',
      'No active cart found. Add items to your cart before checking out.',
      HttpStatus.NOT_FOUND,
    );
  }

  static checkoutCartEmpty(): ApiException {
    return new ApiException(
      'CHECKOUT_CART_EMPTY',
      'Your cart is empty. Add items before checking out.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static checkoutCartChanged(): ApiException {
    return new ApiException(
      'CHECKOUT_CART_CHANGED',
      'Cart has been modified since you last retrieved it. Fetch the latest cart and retry.',
      HttpStatus.CONFLICT,
    );
  }

  static checkoutReservationMissing(sku: string): ApiException {
    return new ApiException(
      'CHECKOUT_RESERVATION_MISSING',
      `Item "${sku}" does not have an active inventory reservation. Please re-reserve before checking out.`,
      HttpStatus.CONFLICT,
    );
  }

  static checkoutReservationExpired(sku: string): ApiException {
    return new ApiException(
      'CHECKOUT_RESERVATION_EXPIRED',
      `Inventory reservation for "${sku}" has expired. Please re-reserve the item before retrying checkout.`,
      HttpStatus.CONFLICT,
    );
  }

  static checkoutReservationMismatch(sku: string): ApiException {
    return new ApiException(
      'CHECKOUT_RESERVATION_MISMATCH',
      `Reserved quantity for "${sku}" does not match cart item quantity. Please re-reserve before checking out.`,
      HttpStatus.CONFLICT,
    );
  }

  static checkoutShippingAddressNotFound(): ApiException {
    return new ApiException(
      'CHECKOUT_SHIPPING_ADDRESS_NOT_FOUND',
      'Shipping address not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static checkoutIdempotencyKeyRequired(): ApiException {
    return new ApiException(
      'CHECKOUT_IDEMPOTENCY_KEY_REQUIRED',
      'X-Idempotency-Key header is required for checkout. It must be between 8 and 100 characters.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static checkoutIdempotencyConflict(): ApiException {
    return new ApiException(
      'CHECKOUT_IDEMPOTENCY_CONFLICT',
      'Checkout idempotency key reused with different request parameters.',
      HttpStatus.CONFLICT,
    );
  }

  static checkoutInventoryConflict(sku: string): ApiException {
    return new ApiException(
      'CHECKOUT_INVENTORY_CONFLICT',
      `Insufficient stock to complete checkout for "${sku}". Another request may have consumed the inventory.`,
      HttpStatus.CONFLICT,
    );
  }

  static checkoutFailed(message?: string): ApiException {
    return new ApiException(
      'CHECKOUT_FAILED',
      message ?? 'Checkout failed. Please try again.',
      HttpStatus.CONFLICT,
    );
  }

  // ── Orders (Phase 5) ─────────────────────────────────────────────────────

  static orderNotFound(): ApiException {
    return new ApiException(
      'ORDER_NOT_FOUND',
      'Order not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  // ── Payment (Phase 6) ────────────────────────────────────────────────────

  static paymentOrderNotFound(): ApiException {
    return new ApiException(
      'PAYMENT_ORDER_NOT_FOUND',
      'Order not found or does not belong to the customer.',
      HttpStatus.NOT_FOUND,
    );
  }

  static paymentOrderNotPayable(message?: string): ApiException {
    return new ApiException(
      'PAYMENT_ORDER_NOT_PAYABLE',
      message ??
        'Order is not in payable state (must be PENDING with positive amount).',
      HttpStatus.CONFLICT,
    );
  }

  static paymentAlreadyPaid(): ApiException {
    return new ApiException(
      'PAYMENT_ALREADY_PAID',
      'Order has already been paid.',
      HttpStatus.CONFLICT,
    );
  }

  static paymentIdempotencyKeyRequired(): ApiException {
    return new ApiException(
      'PAYMENT_IDEMPOTENCY_KEY_REQUIRED',
      'X-Idempotency-Key header is required (between 8 and 100 characters).',
      HttpStatus.BAD_REQUEST,
    );
  }

  static paymentIdempotencyConflict(): ApiException {
    return new ApiException(
      'PAYMENT_IDEMPOTENCY_CONFLICT',
      'Payment idempotency key reused with different request parameters.',
      HttpStatus.CONFLICT,
    );
  }

  static paymentProcessingFailed(message?: string): ApiException {
    return new ApiException(
      'PAYMENT_PROCESSING_FAILED',
      message ?? 'Mock payment processing failed.',
      HttpStatus.CONFLICT,
    );
  }

  // ── Cancellation (Phase 6) ───────────────────────────────────────────────

  static orderNotCancellable(message?: string): ApiException {
    return new ApiException(
      'ORDER_NOT_CANCELLABLE',
      message ?? 'Order cannot be cancelled in its current state.',
      HttpStatus.CONFLICT,
    );
  }

  static orderAlreadyCancelled(): ApiException {
    return new ApiException(
      'ORDER_ALREADY_CANCELLED',
      'Order has already been cancelled.',
      HttpStatus.CONFLICT,
    );
  }

  static orderCancellationIdempotencyConflict(): ApiException {
    return new ApiException(
      'ORDER_CANCELLATION_IDEMPOTENCY_CONFLICT',
      'Cancellation idempotency key reused with different request parameters.',
      HttpStatus.CONFLICT,
    );
  }

  // ── Refund (Phase 6) ─────────────────────────────────────────────────────

  static refundOrderNotCancelled(): ApiException {
    return new ApiException(
      'REFUND_ORDER_NOT_CANCELLED',
      'Refund is only permitted for cancelled orders.',
      HttpStatus.CONFLICT,
    );
  }

  static refundPaymentNotFound(): ApiException {
    return new ApiException(
      'REFUND_PAYMENT_NOT_FOUND',
      'No successful payment found for this order.',
      HttpStatus.NOT_FOUND,
    );
  }

  static refundNotAllowed(message?: string): ApiException {
    return new ApiException(
      'REFUND_NOT_ALLOWED',
      message ?? 'Refund is not allowed for this payment.',
      HttpStatus.CONFLICT,
    );
  }

  static refundAmountInvalid(message?: string): ApiException {
    return new ApiException(
      'REFUND_AMOUNT_INVALID',
      message ?? 'Refund amount must be a positive decimal string.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static refundAmountExceedsPayment(message?: string): ApiException {
    return new ApiException(
      'REFUND_AMOUNT_EXCEEDS_PAYMENT',
      message ??
        'Requested refund amount exceeds remaining refundable balance.',
      HttpStatus.CONFLICT,
    );
  }

  static refundAlreadyComplete(): ApiException {
    return new ApiException(
      'REFUND_ALREADY_COMPLETE',
      'Payment has already been fully refunded.',
      HttpStatus.CONFLICT,
    );
  }

  static refundIdempotencyConflict(): ApiException {
    return new ApiException(
      'REFUND_IDEMPOTENCY_CONFLICT',
      'Refund idempotency key reused with different request parameters.',
      HttpStatus.CONFLICT,
    );
  }

  static refundProcessingFailed(message?: string): ApiException {
    return new ApiException(
      'REFUND_PROCESSING_FAILED',
      message ?? 'Mock refund processing failed.',
      HttpStatus.CONFLICT,
    );
  }

  // ── LLM Agent & Tracing (Phase 7) ────────────────────────────────────────

  static llmNotConfigured(message?: string): ApiException {
    return new ApiException(
      'LLM_NOT_CONFIGURED',
      message ?? 'LLM provider API key is not configured on the server.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  static llmProviderError(message?: string): ApiException {
    return new ApiException(
      'LLM_PROVIDER_ERROR',
      message ?? 'LLM provider returned an error.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  static llmInvalidResponse(message?: string): ApiException {
    return new ApiException(
      'LLM_INVALID_RESPONSE',
      message ?? 'LLM provider returned an invalid response format.',
      HttpStatus.BAD_GATEWAY,
    );
  }

  static agentRunNotFound(): ApiException {
    return new ApiException(
      'AGENT_RUN_NOT_FOUND',
      'Agent run not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static agentInstructionInvalid(message?: string): ApiException {
    return new ApiException(
      'AGENT_INSTRUCTION_INVALID',
      message ?? 'Agent instruction is invalid or exceeds maximum length.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static agentMaxStepsReached(message?: string): ApiException {
    return new ApiException(
      'AGENT_MAX_STEPS_REACHED',
      message ?? 'Agent execution exceeded the maximum allowed step limit.',
      HttpStatus.CONFLICT,
    );
  }

  static agentToolNotFound(toolName: string): ApiException {
    return new ApiException(
      'AGENT_TOOL_NOT_FOUND',
      `Tool "${toolName}" is not registered or not permitted for this agent.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  static agentToolInvalidArguments(message?: string): ApiException {
    return new ApiException(
      'AGENT_TOOL_INVALID_ARGUMENTS',
      message ?? 'Tool arguments failed schema or runtime validation.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static agentToolExecutionFailed(message?: string): ApiException {
    return new ApiException(
      'AGENT_TOOL_EXECUTION_FAILED',
      message ?? 'Tool execution failed.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static agentExecutionBudgetExceeded(message?: string): ApiException {
    return new ApiException(
      'AGENT_EXECUTION_BUDGET_EXCEEDED',
      message ?? 'Agent execution budget exceeded.',
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }

  // ── QA Framework (Phase 8) ──────────────────────────────────────────────

  static qaScenarioNotFound(code?: string): ApiException {
    return new ApiException(
      'QA_SCENARIO_NOT_FOUND',
      code ? `QA scenario "${code}" was not found.` : 'QA scenario not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static qaScenarioInactive(code: string): ApiException {
    return new ApiException(
      'QA_SCENARIO_INACTIVE',
      `QA scenario "${code}" is currently inactive.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  static qaScenarioInvalid(message?: string): ApiException {
    return new ApiException(
      'QA_SCENARIO_INVALID',
      message ?? 'QA scenario definition is invalid.',
      HttpStatus.BAD_REQUEST,
    );
  }

  static qaTemplateVariableNotFound(variableName: string): ApiException {
    return new ApiException(
      'QA_TEMPLATE_VARIABLE_NOT_FOUND',
      `Required scenario variable "${variableName}" could not be resolved from fixture context.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  static qaFixtureSetupFailed(message?: string): ApiException {
    return new ApiException(
      'QA_FIXTURE_SETUP_FAILED',
      message ?? 'Failed to setup scenario database fixture.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  static qaStateSnapshotFailed(message?: string): ApiException {
    return new ApiException(
      'QA_STATE_SNAPSHOT_FAILED',
      message ?? 'Failed to capture QA state snapshot.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  static qaRunNotFound(runId?: string): ApiException {
    return new ApiException(
      'QA_RUN_NOT_FOUND',
      runId ? `QA run "${runId}" was not found.` : 'QA run not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  static qaRunInfrastructureFailed(message?: string): ApiException {
    return new ApiException(
      'QA_RUN_INFRASTRUCTURE_FAILED',
      message ?? 'QA framework infrastructure failure occurred.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
