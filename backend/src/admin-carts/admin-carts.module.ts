import { Module } from '@nestjs/common';
import { AdminCartsController } from './admin-carts.controller';
import { AdminCartsService } from './admin-carts.service';

@Module({
  controllers: [AdminCartsController],
  providers: [AdminCartsService],
  exports: [AdminCartsService],
})
export class AdminCartsModule {}
