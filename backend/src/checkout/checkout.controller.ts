import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@ApiTags('Checkout')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.CUSTOMER)
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Checkout active cart',
    description:
      "Converts the authenticated customer's active cart into an order. " +
      'Validates shipping address ownership, active inventory reservations, ' +
      'and cart version. Idempotent based on X-Idempotency-Key. CUSTOMER only.\n\n' +
      '**First checkout:** Returns HTTP 201 with `replayed: false`.\n\n' +
      '**Replay (same key + same data):** Returns HTTP 200 with `replayed: true` and the original order.\n\n' +
      '**Conflict (same key, different data):** Returns HTTP 409 CHECKOUT_IDEMPOTENCY_CONFLICT.',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: true,
    description:
      'Unique key (8–100 characters) for idempotent checkout. Reusing the same key with identical request data replays the successful checkout without side effects.',
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
    description: 'Order created successfully (first checkout)',
  })
  @ApiResponse({
    status: 200,
    description: 'Replayed idempotent checkout response',
  })
  @ApiResponse({
    status: 400,
    description: 'Empty cart, invalid input, or missing idempotency key',
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Not a CUSTOMER' })
  @ApiResponse({
    status: 404,
    description: 'Active cart or shipping address not found',
  })
  @ApiResponse({
    status: 409,
    description:
      'Cart version conflict, reservation expired/missing/mismatch, inventory conflict, or idempotency conflict',
  })
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.checkoutService.checkout(
      user.id,
      dto,
      idempotencyKey,
    );
    const statusCode = result.replayed ? HttpStatus.OK : HttpStatus.CREATED;
    res.status(statusCode).json(result);
  }
}
