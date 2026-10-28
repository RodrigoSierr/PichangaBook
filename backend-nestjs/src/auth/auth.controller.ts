import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { AuthService } from './auth.service';
import { FirebaseLoginDto, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Paso 1: solicitar código SMS (OTP de 6 dígitos). */
  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  /** Paso 2: validar OTP → login o registro diferenciado (ORGANIZER / OWNER / PLAYER). */
  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code, dto.fullName, dto.role);
  }

  /** Producción: la app valida el SMS con Firebase y envía el ID token. */
  @Public()
  @Post('firebase')
  @HttpCode(200)
  firebase(@Body() dto: FirebaseLoginDto) {
    return this.auth.loginWithFirebase(dto.idToken, dto.fullName, dto.role);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}
