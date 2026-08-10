import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../common/exceptions/api.exception';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { Address, AddressType } from '../generated/prisma/client';

const MAX_ADDRESSES_PER_USER = 10;

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listAddresses(userId: number): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [
        { type: 'asc' },
        { isDefault: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });
  }

  async createAddress(userId: number, dto: CreateAddressDto): Promise<Address> {
    const totalCount = await this.prisma.address.count({
      where: { userId },
    });

    if (totalCount >= MAX_ADDRESSES_PER_USER) {
      throw ApiException.addressLimitReached();
    }

    const countOfType = await this.prisma.address.count({
      where: { userId, type: dto.type },
    });

    // First address of a given type automatically becomes default
    const shouldBeDefault = countOfType === 0 ? true : (dto.isDefault ?? false);

    return this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId, type: dto.type, isDefault: true },
          data: { isDefault: false },
        });
      }

      const address = await tx.address.create({
        data: {
          userId,
          type: dto.type,
          fullName: dto.fullName.trim(),
          phone: dto.phone.trim(),
          addressLine1: dto.addressLine1.trim(),
          addressLine2: dto.addressLine2 ? dto.addressLine2.trim() : null,
          city: dto.city.trim(),
          state: dto.state ? dto.state.trim() : null,
          postalCode: dto.postalCode.trim(),
          country: dto.country.trim(),
          isDefault: shouldBeDefault,
        },
      });

      await this.auditService.logInTransaction(
        {
          userId,
          action: 'ADDRESS_CREATED',
          entityType: 'Address',
          entityId: String(address.id),
          success: true,
          metadata: {
            type: address.type,
            isDefault: address.isDefault,
          },
        },
        tx,
      );

      return address;
    });
  }

  async getAddress(userId: number, addressId: number): Promise<Address> {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!address) {
      throw ApiException.addressNotFound();
    }

    return address;
  }

  async updateAddress(
    userId: number,
    addressId: number,
    dto: UpdateAddressDto,
  ): Promise<Address> {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!existing) {
      throw ApiException.addressNotFound();
    }

    const targetType = dto.type ?? existing.type;
    const isChangingType = dto.type !== undefined && dto.type !== existing.type;

    // Check if user has an existing default for the target type
    const currentDefaultForTargetType = await this.prisma.address.findFirst({
      where: {
        userId,
        type: targetType,
        isDefault: true,
        NOT: { id: addressId },
      },
    });

    // Determine if updated address should be default
    let shouldBeDefault = dto.isDefault ?? existing.isDefault;
    if (isChangingType && !currentDefaultForTargetType) {
      shouldBeDefault = true;
    }

    return this.prisma.$transaction(async (tx) => {
      // If changing type and old address was default, promote lowest ID remaining of old type
      if (isChangingType && existing.isDefault) {
        const remainingOldType = await tx.address.findFirst({
          where: { userId, type: existing.type, NOT: { id: addressId } },
          orderBy: { id: 'asc' },
        });

        if (remainingOldType) {
          await tx.address.update({
            where: { id: remainingOldType.id },
            data: { isDefault: true },
          });
        }
      }

      // If new state is default, clear other defaults of targetType
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId, type: targetType, NOT: { id: addressId } },
          data: { isDefault: false },
        });
      }

      const updated = await tx.address.update({
        where: { id: addressId },
        data: {
          ...(dto.type && { type: dto.type }),
          ...(dto.fullName && { fullName: dto.fullName.trim() }),
          ...(dto.phone && { phone: dto.phone.trim() }),
          ...(dto.addressLine1 && { addressLine1: dto.addressLine1.trim() }),
          ...(dto.addressLine2 !== undefined && {
            addressLine2: dto.addressLine2 ? dto.addressLine2.trim() : null,
          }),
          ...(dto.city && { city: dto.city.trim() }),
          ...(dto.state !== undefined && {
            state: dto.state ? dto.state.trim() : null,
          }),
          ...(dto.postalCode && { postalCode: dto.postalCode.trim() }),
          ...(dto.country && { country: dto.country.trim() }),
          isDefault: shouldBeDefault,
        },
      });

      await this.auditService.logInTransaction(
        {
          userId,
          action: 'ADDRESS_UPDATED',
          entityType: 'Address',
          entityId: String(addressId),
          success: true,
          metadata: {
            updatedFields: Object.keys(dto),
            isDefault: updated.isDefault,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async setDefault(userId: number, addressId: number): Promise<Address> {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!existing) {
      throw ApiException.addressNotFound();
    }

    if (existing.isDefault) {
      return existing; // Idempotent
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, type: existing.type, isDefault: true },
        data: { isDefault: false },
      });

      const updated = await tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      });

      await this.auditService.logInTransaction(
        {
          userId,
          action: 'ADDRESS_DEFAULT_CHANGED',
          entityType: 'Address',
          entityId: String(addressId),
          success: true,
          metadata: { type: existing.type },
        },
        tx,
      );

      return updated;
    });
  }

  async deleteAddress(
    userId: number,
    addressId: number,
  ): Promise<{ message: string }> {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });

    if (!existing) {
      throw ApiException.addressNotFound();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({
        where: { id: addressId },
      });

      // If deleted address was default, promote the lowest-ID remaining address of the same type
      if (existing.isDefault) {
        const remainingLowest = await tx.address.findFirst({
          where: { userId, type: existing.type },
          orderBy: { id: 'asc' },
        });

        if (remainingLowest) {
          await tx.address.update({
            where: { id: remainingLowest.id },
            data: { isDefault: true },
          });
        }
      }

      await this.auditService.logInTransaction(
        {
          userId,
          action: 'ADDRESS_DELETED',
          entityType: 'Address',
          entityId: String(addressId),
          success: true,
          metadata: {
            wasDefault: existing.isDefault,
            type: existing.type,
          },
        },
        tx,
      );
    });

    return { message: 'Address deleted successfully.' };
  }
}
