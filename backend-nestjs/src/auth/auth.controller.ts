import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { AuthService } from './auth.service';
import { DemoSessionDto, FirebaseLoginDto, RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Paso 1: solicitar código SMS (OTP de 6 dígitos). */
  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    const clientIp = typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req?.ip || req?.socket?.remoteAddress;
    return this.auth.requestOtp(dto.phone, clientIp);
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

  /** Sesión rápida firmada con JWT para cuentas semilla (sólo si allowDemoFallback=true). */
  @Public()
  @Post('demo-session')
  @HttpCode(200)
  demoSession(@Body() dto: DemoSessionDto) {
    return this.auth.issueDemoSession(dto.role);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.sub, dto);
  }
}
