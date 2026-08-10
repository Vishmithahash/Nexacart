import { Injectable } from '@nestjs/common';
import { CatalogService } from '../../catalog/catalog.service';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class SearchProductsTool implements AgentTool {
  readonly name = 'search_products';
  readonly description =
    'Search the public NexaCart product catalogue by search term, category slug, or stock availability.';
  readonly isStateChanging = false;

  readonly parameters = {
    type: 'object',
    properties: {
      search: {
        type: ['string', 'null'],
        description:
          'Optional text search query to match against product title or description.',
      },
      category: {
        type: ['string', 'null'],
        description: 'Optional category slug to filter products by category.',
      },
      inStock: {
        type: ['boolean', 'null'],
        description: 'Optional filter for in-stock products only.',
      },
      limit: {
        type: 'integer',
        description:
          'Number of results to return (between 1 and 20, default 10).',
      },
    },
    required: ['search', 'category', 'inStock', 'limit'],
    additionalProperties: false,
  };

  constructor(private readonly catalogService: CatalogService) {}

  async execute(
    args: Record<string, unknown>,
    _context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const search =
        typeof args['search'] === 'string' ? args['search'] : undefined;
      const category =
        typeof args['category'] === 'string' ? args['category'] : undefined;
      const inStock =
        typeof args['inStock'] === 'boolean' ? args['inStock'] : undefined;
      const rawLimit =
        typeof args['limit'] === 'number' ? Math.floor(args['limit']) : 10;
      const limit = Math.max(1, Math.min(20, rawLimit));

      const result = await this.catalogService.listActiveProducts({
        search,
        category,
        inStock,
        limit,
        page: 1,
        sort: 'newest',
      });

      return {
        ok: true,
        data: {
          products: result.data.map((p) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            price: p.price,
            currencyCode: p.currencyCode,
            inStock: p.availableQuantity > 0,
            categoryName: p.category.name,
          })),
          totalItems: result.pagination.totalItems,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'CATALOG_ERROR',
          message: err.message ?? 'Search failed',
          statusCode: err.status ?? 400,
        },
      };
    }
  }
}
