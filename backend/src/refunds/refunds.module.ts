import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { MockRefundGatewayService } from './mock-refund-gateway.service';

@Module({
  controllers: [RefundsController],
  providers: [RefundsService, MockRefundGatewayService],
  exports: [RefundsService, MockRefundGatewayService],
})
export class RefundsModule {}
