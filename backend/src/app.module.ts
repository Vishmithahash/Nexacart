import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { RequestContextModule } from './common/request-context/request-context.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { ClockModule } from './common/clock/clock.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AddressesModule } from './addresses/addresses.module';
import { CatalogModule } from './catalog/catalog.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { CartModule } from './cart/cart.module';
import { AdminCartsModule } from './admin-carts/admin-carts.module';
import { ReservationsModule } from './reservations/reservations.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrdersModule } from './orders/orders.module';
import { AdminOrdersModule } from './admin-orders/admin-orders.module';
import { PaymentsModule } from './payments/payments.module';
import { CancellationsModule } from './cancellations/cancellations.module';
import { RefundsModule } from './refunds/refunds.module';
import { LlmModule } from './llm/llm.module';
import { AgentToolsModule } from './agent-tools/agent-tools.module';
import { AgentModule } from './agent/agent.module';
import { QaModule } from './qa/qa.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        PORT: Joi.number().integer().min(1).max(65535).default(3000),
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().required(),
        CORS_ORIGIN: Joi.string().required(),
        REFRESH_TOKEN_TTL_DAYS: Joi.number()
          .integer()
          .min(1)
          .max(30)
          .default(7),
        CART_RESERVATION_TTL_MINUTES: Joi.number()
          .integer()
          .min(1)
          .max(1440)
          .default(30),
        CART_MAX_DISTINCT_ITEMS: Joi.number()
          .integer()
          .min(1)
          .max(200)
          .default(50),
        CART_MAX_ITEM_QUANTITY: Joi.number()
          .integer()
          .min(1)
          .max(1000)
          .default(100),
        OPENAI_API_KEY: Joi.string().allow('').optional().default(''),
        OPENAI_MODEL: Joi.string().default('gpt-4o'),
        AGENT_MAX_STEPS: Joi.number().integer().min(1).max(50).default(10),
        AGENT_MAX_INSTRUCTION_LENGTH: Joi.number()
          .integer()
          .min(100)
          .max(10000)
          .default(2000),
        AGENT_RUN_TIMEOUT_MS: Joi.number()
          .integer()
          .min(1000)
          .max(300000)
          .default(60000),
      }),
      validationOptions: {
        abortEarly: true,
      },
    }),
    ClockModule,
    RequestContextModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    AddressesModule,
    CatalogModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    CartModule,
    AdminCartsModule,
    ReservationsModule,
    CheckoutModule,
    OrdersModule,
    AdminOrdersModule,
    PaymentsModule,
    CancellationsModule,
    RefundsModule,
    LlmModule,
    AgentToolsModule,
    AgentModule,
    QaModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
