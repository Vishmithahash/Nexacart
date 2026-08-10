import { Injectable } from '@nestjs/common';
import { CatalogService } from '../../catalog/catalog.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class GetProductTool implements AgentTool {
  readonly name = 'get_product';
  readonly description =
    'Get detailed public product information by numeric product ID.';
  readonly isStateChanging = false;

  readonly parameters = {
    type: 'object',
    properties: {
      productId: {
        type: 'integer',
        description: 'Numeric ID of the product to view.',
      },
    },
    required: ['productId'],
    additionalProperties: false,
  };

  constructor(private readonly catalogService: CatalogService) {}

  async execute(
    args: Record<string, unknown>,
    _context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const productId = Number(args['productId']);
      if (!Number.isInteger(productId) || productId <= 0) {
        return {
          ok: false,
          error: {
            errorCode: 'AGENT_TOOL_INVALID_ARGUMENTS',
            message: 'productId must be a positive integer.',
            statusCode: 400,
          },
        };
      }

      const product = await this.catalogService.getActiveProductById(productId);

      return {
        ok: true,
        data: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          description: product.description,
          price: product.price,
          currencyCode: product.currencyCode,
          inStock: product.availableQuantity > 0,
          availableQuantity: product.availableQuantity,
          stockStatus: product.stockStatus,
          category: { id: product.category.id, name: product.category.name },
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'PRODUCT_NOT_FOUND',
          message: err.message ?? 'Product not found',
          statusCode: err.status ?? 404,
        },
      };
    }
  }
}
