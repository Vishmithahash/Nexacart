import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddressType,
  CartStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
  UserRole,
} from '../../generated/prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import { QaFixtureContext, QaFixtureProductRef } from './qa-fixture-context.type';

@Injectable()
export class QaFixtureService {
  private readonly logger = new Logger(QaFixtureService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Set up an isolated synthetic customer environment and DB fixture for a QA run.
   */
  async prepareFixture(
    qaRunId: string,
    fixtureDef: Record<string, unknown>,
  ): Promise<QaFixtureContext> {
    try {
      const shortId = qaRunId.substring(0, 8);
      const email = `qa-${shortId}@nexacart.test`;
      const passwordHash = createHash('sha256').update(`Pass123!${qaRunId}`).digest('hex');

      // 1. Create Synthetic Customer User
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: 'QA',
          lastName: `AgentUser-${shortId}`,
          role: UserRole.CUSTOMER,
        },
      });

      const context: QaFixtureContext = {
        customerId: user.id,
        customerEmail: user.email,
        products: {},
      };

      // 2. Create Shipping Address if specified
      const customerDef = fixtureDef['customer'] as Record<string, unknown> | undefined;
      if (customerDef?.['withShippingAddress'] !== false) {
        const address = await this.prisma.address.create({
          data: {
            userId: user.id,
            type: AddressType.SHIPPING,
            fullName: `${user.firstName} ${user.lastName}`,
            phone: '+15550199283',
            addressLine1: '123 QA Automation Way',
            city: 'Testville',
            state: 'QA State',
            postalCode: '99999',
            country: 'US',
            isDefault: true,
          },
        });
        context.shippingAddressId = address.id;
      }

      // 3. Create Synthetic Products if specified
      const productsDef = (fixtureDef['products'] as Array<Record<string, unknown>>) || [];
      if (productsDef.length === 0) {
        productsDef.push({
          alias: 'targetProduct',
          name: 'QA Wireless Headphones',
          price: '12500.00',
          stockQuantity: 10,
          reservedQuantity: 0,
          status: 'ACTIVE',
        });
      }

      let category = await this.prisma.category.findFirst({
        where: { slug: 'electronics' },
      });
      if (!category) {
        category = await this.prisma.category.create({
          data: {
            name: 'Electronics',
            slug: 'electronics',
            description: 'Electronic products',
          },
        });
      }

      for (const pDef of productsDef) {
        const alias = String(pDef['alias'] || 'targetProduct');
        const name = `QA-${shortId}-${String(pDef['name'] || 'Product')}`;
        const sku = `SKU-QA-${shortId}-${alias.toUpperCase()}`;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const priceStr = String(pDef['price'] || '100.00');
        const stockQuantity = Number(pDef['stockQuantity'] ?? 10);
        const reservedQuantity = Number(pDef['reservedQuantity'] ?? 0);
        const status = (pDef['status'] as ProductStatus) || ProductStatus.ACTIVE;

        const product = await this.prisma.product.create({
          data: {
            categoryId: category.id,
            sku,
            name,
            slug,
            description: 'Synthetic product for QA scenario',
            price: new Decimal(priceStr),
            currencyCode: 'USD',
            stockQuantity,
            reservedQuantity,
            status,
          },
        });

        const prodRef: QaFixtureProductRef = {
          id: product.id,
          sku: product.sku,
          name: product.name,
          price: product.price.toFixed(2),
          stockQuantity: product.stockQuantity,
          reservedQuantity: product.reservedQuantity,
        };

        context.products[alias] = prodRef;
      }

      // 4. Prepare Cart if specified
      const cartDef = fixtureDef['cart'] as Record<string, unknown> | undefined;
      if (cartDef?.['create'] !== false) {
        const cart = await this.prisma.cart.create({
          data: {
            userId: user.id,
            status: CartStatus.ACTIVE,
            version: 1,
            lastActivityAt: new Date(),
          },
        });
        context.cartId = cart.id;
        context.cartVersion = cart.version;

        const itemsDef = (cartDef?.['items'] as Array<Record<string, unknown>>) || [];
        for (const itemDef of itemsDef) {
          const alias = String(itemDef['productAlias'] || 'targetProduct');
          const prodRef = context.products[alias];
          if (prodRef) {
            const quantity = Number(itemDef['quantity'] || 1);
            const unitPrice = new Decimal(prodRef.price);

            const cartItem = await this.prisma.cartItem.create({
              data: {
                cartId: cart.id,
                productId: prodRef.id,
                quantity,
                unitPrice,
              },
            });

            if (itemDef['withReservation'] !== false) {
              await this.prisma.inventoryReservation.create({
                data: {
                  cartId: cart.id,
                  cartItemId: cartItem.id,
                  productId: prodRef.id,
                  quantity,
                  status: 'ACTIVE',
                  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                },
              });

              await this.prisma.product.update({
                where: { id: prodRef.id },
                data: { reservedQuantity: { increment: quantity } },
              });
              prodRef.reservedQuantity += quantity;
            }
          }
        }
      }

      // 5. Prepare Order if specified
      const orderDef = fixtureDef['order'] as Record<string, unknown> | undefined;
      if (orderDef) {
        const orderNumber = `NXC-QA-${shortId}`;
        const totalAmountStr = String(orderDef['totalAmount'] || '12500.00');
        const totalAmount = new Decimal(totalAmountStr);

        const order = await this.prisma.order.create({
          data: {
            userId: user.id,
            orderNumber,
            status: (orderDef['status'] as OrderStatus) || OrderStatus.PENDING,
            paymentStatus: (orderDef['paymentStatus'] as PaymentStatus) || PaymentStatus.PENDING,
            shippingAddress: { fullName: user.firstName, line1: '123 QA Way' },
            currencyCode: 'USD',
            subtotal: totalAmount,
            shippingAmount: new Decimal(0),
            discountAmount: new Decimal(0),
            totalAmount,
          },
        });

        context.orderId = order.id;
        context.orderNumber = order.orderNumber;

        if (orderDef['isPaid'] === true || orderDef['paymentStatus'] === 'PAID') {
          const payment = await this.prisma.payment.create({
            data: {
              orderId: order.id,
              method: PaymentMethod.MOCK,
              status: PaymentStatus.PAID,
              amount: totalAmount,
              transactionReference: `MOCK-PAY-${shortId}`,
              idempotencyKey: `pay-key-${shortId}`,
              paidAt: new Date(),
            },
          });

          await this.prisma.paymentAttempt.create({
            data: {
              orderId: order.id,
              paymentId: payment.id,
              status: PaymentAttemptStatus.SUCCEEDED,
              idempotencyKey: `pay-key-${shortId}`,
              amount: totalAmount,
              transactionReference: payment.transactionReference,
            },
          });

          await this.prisma.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PAID },
          });
        }
      }

      return context;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Fixture setup failed for run ${qaRunId}: ${msg}`);
      throw ApiException.qaFixtureSetupFailed(`Fixture setup failed: ${msg}`);
    }
  }
}
