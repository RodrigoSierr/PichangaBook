import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public, Roles } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { DateQuery } from '../complexes/dto/complexes.dto';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, PaySplitSlotDto, ReceptionBlockDto } from './dto/bookings.dto';

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Historial de reservas del jugador u organizador autenticado. */
  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Get('bookings/my')
  myBookings(@CurrentUser() user: AuthUser) {
    return this.bookings.myBookings(user.sub);
  }

  /** Reserva desde la App Móvil (FULL_DEPOSIT o SPLIT). Exige JWT y sourceId válido. */
  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('bookings')
  create(@Body() dto: CreateBookingDto, @CurrentUser() user: AuthUser) {
    return this.bookings.createBooking(dto, user);
  }

  /** Bloqueo Rápido en Recepción (ventas en boletería o por teléfono). Exige rol OWNER y propiedad del complejo. */
  @Roles('OWNER', 'ADMIN')
  @Post('bookings/reception-block')
  receptionBlock(@Body() dto: ReceptionBlockDto, @CurrentUser() user: AuthUser) {
    return this.bookings.receptionBlock(dto, user);
  }

  /** Liberar un turno bloqueado o cancelar una reserva (sólo dueño del complejo o titular de la reserva). */
  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Delete('bookings/:id')
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookings.releaseBooking(id, user);
  }

  /** Dashboard omnicanal del dueño de complejo (ocupación, KPIs, parrilla y feed en vivo). */
  @Roles('OWNER', 'ADMIN')
  @Get('owner/complexes/:id/dashboard')
  dashboard(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DateQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookings.ownerDashboard(id, q.date, user);
  }

  /** Reporte consolidado de reservas e ingresos conciliados para el dueño del complejo (exportación CSV). */
  @Roles('OWNER', 'ADMIN')
  @Get('owner/complexes/:id/report')
  report(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bookings.ownerReport(id, user);
  }

  /** Ejecución manual/administrativa de liberación de reservas HELD vencidas. */
  @Roles('OWNER', 'ADMIN')
  @Post('bookings/expire-holds')
  @HttpCode(200)
  async expireHolds() {
    const expiredCount = await this.bookings.expireStaleHolds();
    return { expiredCount };
  }

  /** Estado en vivo del Split Payment ("Cupos pagados: 4 de 6") para el link compartido en WhatsApp. */
  @Public()
  @Get('split-payments/:token')
  getSplit(@Param('token') token: string) {
    return this.bookings.getSplitByToken(token);
  }

  /** Abonar 1 cupo del Split Payment (Yape / Plin / Tarjeta). Exige usuario autenticado y sourceId válido. */
  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('split-payments/:token/pay')
  @HttpCode(200)
  paySplit(
    @Param('token') token: string,
    @Body() dto: PaySplitSlotDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bookings.paySplitSlot(token, dto, user);
  }

  /**
   * Webhook de Culqi (`charge.creation.succeeded` / `charge.creation.pending` / `charge.creation.failed`).
   * Verifica firma HMAC-SHA256 sobre `rawBody`, estructura del payload, moneda (`PEN`),
   * estado del cargo, referencia local y monto exacto antes de acreditar.
   */
  @Public()
  @Post('payments/webhooks/culqi')
  @HttpCode(200)
  async culqiWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-culqi-signature') signature?: string,
  ) {
    return this.bookings.processCulqiWebhook(req.rawBody, signature, body);
  }
}
