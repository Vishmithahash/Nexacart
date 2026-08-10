import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PaymentsService } from './payments.service';
import { PayOrderDto } from './dto/pay-order.dto';

@ApiTags('Payments')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('orders')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':orderNumber/pay')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Pay order (mock)',
    description:
      "Processes a mock payment for the customer's own order. " +
      'Payment amount is strictly determined by Order.totalAmount. ' +
      'On successful payment, Order status changes to CONFIRMED and paymentStatus to PAID. CUSTOMER only.\n\n' +
      '**First payment:** Returns HTTP 201 with `replayed: false`.\n\n' +
      '**Idempotent Replay:** Reusing the same X-Idempotency-Key returns HTTP 200 with `replayed: true`.\n\n' +
      '**Duplicate Payment under new key:** Returns HTTP 409 PAYMENT_ALREADY_PAID.',
  })
  @ApiParam({
    name: 'orderNumber',
    type: String,
    description: 'Order number to pay (e.g. NXC-550E8400)',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description:
      'Unique key (8–100 characters) for idempotent payment processing.',
  })
  @ApiHeader({
    name: 'X-Request-ID',
    required: false,
    description: 'Optional correlation request ID for QA traceability.',
  })
  @ApiHeader({
    name: 'X-QA-Run-ID',
    required: false,
    description: 'Optional QA run identifier for research traceability.',
  })
  @ApiHeader({
    name: 'X-Tool-Call-ID',
    required: false,
    description: 'Optional tool call identifier for LLM agent traceability.',
  })
  @ApiResponse({
    status: 201,
    description: 'Payment processed successfully (first payment)',
  })
  @ApiResponse({ status: 200, description: 'Idempotent replay response' })
  @ApiResponse({
    status: 400,
    description: 'Missing/invalid idempotency key or invalid payload',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not a CUSTOMER' })
  @ApiResponse({
    status: 404,
    description: 'Order not found or not owned by customer',
  })
  @ApiResponse({
    status: 409,
    description:
      'Order already paid (different key), order not in payable state, or payment processing failed',
  })
  async payOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
    @Body() dto: PayOrderDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.paymentsService.payOrder(
      user.id,
      orderNumber,
      dto,
      idempotencyKey,
    );

    const statusCode = result.replayed ? HttpStatus.OK : HttpStatus.CREATED;
    res.status(statusCode).json(result);
  }
}
