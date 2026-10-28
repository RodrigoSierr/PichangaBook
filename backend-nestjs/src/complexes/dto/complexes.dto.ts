import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListComplexesQuery {
  @IsOptional() @IsString() @MaxLength(32)
  district?: string;

  @IsOptional() @Type(() => Number) @IsLatitude()
  lat?: number;

  @IsOptional() @Type(() => Number) @IsLongitude()
  lng?: number;

  @IsOptional() @IsString() @MaxLength(60)
  q?: string;
}

export class CreateComplexDto {
  @IsString() @Length(3, 120)
  name: string;

  @IsString() @Matches(/^\d{11}$/, { message: 'El RUC tiene 11 dígitos' })
  ruc: string;

  @IsOptional() @IsString() @MaxLength(160)
  businessName?: string;

  @IsString() @MaxLength(32)
  districtCode: string;

  @IsString() @Length(5, 200)
  address: string;

  @IsOptional() @Type(() => Number) @IsNumber()
  lat?: number;

  @IsOptional() @Type(() => Number) @IsNumber()
  lng?: number;
}

export class ReviewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5)
  rating: number;

  @IsOptional() @IsString() @MaxLength(400)
  comment?: string;
}

export class VerificationDto {
  @IsIn(['VERIFIED', 'REJECTED', 'IN_REVIEW'])
  status: 'VERIFIED' | 'REJECTED' | 'IN_REVIEW';

  @IsOptional() @IsString() @MaxLength(300)
  notes?: string;
}

export class DateQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Fecha en formato YYYY-MM-DD' })
  date?: string;
}
