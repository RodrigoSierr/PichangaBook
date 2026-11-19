import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListSubstitutesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  onlyVerified?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minSkill?: number;
}

export class InviteSubstituteDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'Se requiere un bookingId UUID válido de una reserva activa para convocar a un suplente.',
  })
  bookingId: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;
}

export class SendRelayMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'Escribe un mensaje' })
  @MaxLength(500)
  text: string;
}

export class UpsertSubstituteProfileDto {
  @IsIn(['ARQUERO', 'DEFENSA', 'MEDIOCAMPO', 'DELANTERO'])
  position: 'ARQUERO' | 'DEFENSA' | 'MEDIOCAMPO' | 'DELANTERO';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  skillLevel?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  districtCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clipPublicId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  clipDurationSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clipUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clipPosterUrl?: string;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class RespondInvitationDto {
  @IsIn(['ACCEPTED', 'DECLINED'])
  status: 'ACCEPTED' | 'DECLINED';
}
