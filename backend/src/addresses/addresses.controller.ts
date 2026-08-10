import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Address } from '../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

@ApiTags('Addresses')
@ApiBearerAuth()
@Controller('users/me/addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  @ApiOperation({
    summary: 'List user addresses',
    description:
      'Returns all addresses for the authenticated user, ordered deterministically.',
  })
  @ApiResponse({
    status: 200,
    description: 'Addresses retrieved successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async listAddresses(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<Address[]> {
    return this.addressesService.listAddresses(currentUser.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create address',
    description:
      'Creates a new address for the authenticated user. First address of a type automatically becomes default. Max 10 addresses.',
  })
  @ApiResponse({ status: 201, description: 'Address created successfully.' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or address limit reached.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async createAddress(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ): Promise<Address> {
    return this.addressesService.createAddress(currentUser.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get address by ID',
    description: 'Returns address details if owned by the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Address retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 404,
    description: 'Address not found or not owned by user.',
  })
  async getAddress(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Address> {
    return this.addressesService.getAddress(currentUser.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update address',
    description: 'Updates an existing address owned by the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Address updated successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 404,
    description: 'Address not found or not owned by user.',
  })
  async updateAddress(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
  ): Promise<Address> {
    return this.addressesService.updateAddress(currentUser.id, id, dto);
  }

  @Patch(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set default address',
    description:
      'Sets target address as default for its type, clearing previous defaults of the same type.',
  })
  @ApiResponse({
    status: 200,
    description: 'Default address updated successfully.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 404,
    description: 'Address not found or not owned by user.',
  })
  async setDefault(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Address> {
    return this.addressesService.setDefault(currentUser.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete address',
    description:
      'Deletes an address owned by the user. If default address is deleted, the lowest-ID remaining address of the same type is promoted.',
  })
  @ApiResponse({ status: 200, description: 'Address deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 404,
    description: 'Address not found or not owned by user.',
  })
  async deleteAddress(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ message: string }> {
    return this.addressesService.deleteAddress(currentUser.id, id);
  }
}
