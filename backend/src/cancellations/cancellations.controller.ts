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
import { CancellationsService } from './cancellations.service';
import { CancelOrderDto } from './dto/cancel-order.dto';

@ApiTags('Cancellations')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('orders')
export class CancellationsController {
  constructor(private readonly cancellationsService: CancellationsService) {}

  @Post(':orderNumber/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel order',
    description:
      "Cancels the authenticated customer's order if in PENDING or CONFIRMED state. " +
      'Restores purchased stock by creating CANCELLATION_RESTORE inventory movements. ' +
      'Indicates whether a refund is required (if paymentStatus is PAID or PARTIALLY_REFUNDED). CUSTOMER only.\n\n' +
      '**First cancellation:** Returns HTTP 200 with `replayed: false`.\n\n' +
      '**Idempotent Replay:** Reusing the same X-Idempotency-Key returns HTTP 200 with `replayed: true`.',
  })
  @ApiParam({
    name: 'orderNumber',
    type: String,
    description: 'Order number to cancel (e.g. NXC-550E8400)',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description:
      'Unique key (8–100 characters) for idempotent order cancellation.',
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
    status: 200,
    description: 'Order cancelled successfully or replayed',
  })
  @ApiResponse({
    status: 400,
    description: 'Missing/invalid idempotency key or reason',
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
      'Order not in cancellable state (COMPLETED, SHIPPED, DELIVERED) or cancellation idempotency conflict',
  })
  async cancelOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderNumber') orderNumber: string,
    @Body() dto: CancelOrderDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.cancellationsService.cancelOrder(
      user.id,
      orderNumber,
      dto,
      idempotencyKey,
    );

    res.status(HttpStatus.OK).json(result);
  }
}
