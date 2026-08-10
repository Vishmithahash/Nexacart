import { Module } from '@nestjs/common';
import { AdminCategoriesController } from './admin-categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  controllers: [AdminCategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
