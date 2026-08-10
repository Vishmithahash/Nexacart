import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ReservationsService } from './reservations.service';
import { ExpireReservationsDto } from './dto/expire-reservations-query.dto';

@ApiTags('Inventory Reservations')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/cart-reservations')
export class AdminReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post('expire-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Process due expired inventory reservations',
    description:
      'Scans for due ACTIVE inventory reservations (expiresAt <= server time) and releases reserved stock in deterministic serializable transactions. ADMIN only.',
  })
  @ApiResponse({ status: 200, description: 'Batch expiration results' })
  expireDueReservations(@Body() dto: ExpireReservationsDto) {
    return this.reservationsService.expireDueReservations(dto);
  }
}
