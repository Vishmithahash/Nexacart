import { Module } from '@nestjs/common';
import { AdminProductsController } from './admin-products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [AdminProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
