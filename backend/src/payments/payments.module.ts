import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MockPaymentGatewayService } from './mock-payment-gateway.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentGatewayService],
  exports: [PaymentsService, MockPaymentGatewayService],
})
export class PaymentsModule {}
