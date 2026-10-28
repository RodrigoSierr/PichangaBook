import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^[+\d\s-]{9,16}$/, { message: 'Número de celular inválido' })
  phone: string;
}

/** Registro diferenciado: sólo se permiten roles públicos (ADMIN no). */
export const PUBLIC_ROLES = ['ORGANIZER', 'OWNER', 'PLAYER'] as const;

export class VerifyOtpDto {
  @IsString()
  @Matches(/^[+\d\s-]{9,16}$/)
  phone: string;

  @IsString()
  @Length(6, 6, { message: 'El código OTP tiene 6 dígitos' })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsIn(PUBLIC_ROLES)
  role?: (typeof PUBLIC_ROLES)[number];
}

export class FirebaseLoginDto {
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsIn(PUBLIC_ROLES)
  @Type(() => String)
  role?: (typeof PUBLIC_ROLES)[number];
}
