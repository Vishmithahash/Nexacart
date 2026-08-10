import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AddressType } from '../../generated/prisma/client';

export class CreateAddressDto {
  @ApiProperty({ enum: AddressType, example: AddressType.SHIPPING })
  @IsEnum(AddressType, { message: 'Type must be SHIPPING or BILLING.' })
  @IsNotEmpty()
  type!: AddressType;

  @ApiProperty({ example: 'Test Customer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  fullName!: string;

  @ApiProperty({ example: '+94771234567' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  phone!: string;

  @ApiProperty({ example: '12 Main Road' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  addressLine1!: string;

  @ApiPropertyOptional({ example: 'Apartment 4' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  addressLine2?: string;

  @ApiProperty({ example: 'Colombo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  city!: string;

  @ApiPropertyOptional({ example: 'Western Province' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  state?: string;

  @ApiProperty({ example: '00100' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  postalCode!: string;

  @ApiProperty({ example: 'Sri Lanka' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  country!: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean = false;
}
