import { Injectable } from '@nestjs/common';
import { AddressesService } from '../../addresses/addresses.service';
import { AddressType } from '../../generated/prisma/client';
import {
  AgentExecutionContext,
  AgentTool,
  StandardToolResultEnvelope,
} from '../agent-tool.interface';

@Injectable()
export class ListShippingAddressesTool implements AgentTool {
  readonly name = 'list_shipping_addresses';
  readonly description =
    'List all shipping addresses belonging to the authenticated customer.';
  readonly isStateChanging = false;

  readonly parameters = {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  };

  constructor(private readonly addressesService: AddressesService) {}

  async execute(
    _args: Record<string, unknown>,
    context: AgentExecutionContext,
  ): Promise<StandardToolResultEnvelope> {
    try {
      const addresses = await this.addressesService.listAddresses(
        context.userId,
      );
      const shippingAddresses = addresses
        .filter((a) => a.type === AddressType.SHIPPING)
        .map((a) => ({
          id: a.id,
          fullName: a.fullName,
          phone: a.phone,
          addressLine1: a.addressLine1,
          addressLine2: a.addressLine2,
          city: a.city,
          state: a.state,
          postalCode: a.postalCode,
          country: a.country,
          isDefault: a.isDefault,
        }));

      return {
        ok: true,
        data: {
          addresses: shippingAddresses,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          errorCode: err.errorCode ?? 'ADDRESS_ERROR',
          message: err.message ?? 'Failed to list shipping addresses',
          statusCode: err.status ?? 400,
        },
      };
    }
  }
}
