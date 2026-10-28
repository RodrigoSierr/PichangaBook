import {
  BadRequestException,
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
} from '@nestjs/common';
import { CurrentUser, Public } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { limaToday } from '../common/utils/time.util';
import { CulqiService } from '../integrations/culqi.service';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, PaySplitSlotDto, ReceptionBlockDto } from './dto/bookings.dto';

@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly culqi: CulqiService,
  ) {}

  /** Crear reserva desde la app móvil (seña completa o Split Payment). */
  @Public()
  @Post('bookings')
  create(@Body() dto: CreateBookingDto, @CurrentUser() user?: AuthUser) {
    return this.bookings.createBooking(dto, user);
  }

  /** Bloqueo rápido desde el Panel de Recepción (ventas presenciales o telefónicas). */
  @Public()
  @Post('bookings/reception-block')
  receptionBlock(@Body() dto: ReceptionBlockDto, @CurrentUser() user?: AuthUser) {
    return this.bookings.receptionBlock(dto, user);
  }

  /** Liberar turno bloqueado o cancelar reserva. */
  @Public()
  @Delete('bookings/:id')
  release(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.bookings.releaseBooking(id, user);
  }

  @Public()
  @Post('bookings/:id/release')
  @HttpCode(200)
  releasePost(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.bookings.releaseBooking(id, user);
  }

  /** Dashboard omnicanal del dueño de complejo. */
  @Public()
  @Get('owner/complexes/:id/dashboard')
  ownerDashboard(@Param('id') id: string, @Query('date') date?: string) {
    return this.bookings.ownerDashboard(id, date ?? limaToday());
  }

  /** Consultar estado en vivo del Split Payment ("Cupos pagados: 4 de 6"). */
  @Public()
  @Get('split-payments/:token')
  getSplit(@Param('token') token: string) {
    return this.bookings.getSplitByToken(token);
  }

  /** Pagar 1 cupo del Split Payment (Yape, Plin o Tarjeta). */
  @Public()
  @Post('split-payments/:token/pay')
  @HttpCode(200)
  paySplit(
    @Param('token') token: string,
    @Body() dto: PaySplitSlotDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.bookings.paySplitSlot(token, dto, user);
  }

  /** Webhook oficial / simulado de Culqi (con verificación HMAC-SHA256). */
  @Public()
  @Post('payments/webhooks/culqi')
  @HttpCode(200)
  async culqiWebhook(
    @Body() body: { type?: string; data?: string; metadata?: Record<string, string> },
    @Headers('x-culqi-signature') signature?: string,
  ) {
    const raw = JSON.stringify(body);
    if (signature && !this.culqi.verifySignature(raw, signature)) {
      throw new BadRequestException('Firma x-culqi-signature inválida');
    }
    const charge = body.data ? JSON.parse(body.data) : body;
    const token = charge?.metadata?.splitToken;
    const payerName = charge?.metadata?.payerName || 'Jugador WebHook';
    const rawMethod = (charge?.source?.type || 'yape').toString().toUpperCase();
    const method: 'CARD' | 'YAPE' | 'PLIN' =
      rawMethod === 'CARD' || rawMethod === 'PLIN' ? rawMethod : 'YAPE';

    if (token) {
      const sp = await this.bookings.getSplitByToken(token);
      await this.bookings.recordVerifiedShare({
        splitId: sp.id,
        bookingId: sp.bookingId,
        complexId: sp.complexId,
        courtId: sp.courtId,
        courtName: sp.courtName,
        date: sp.date,
        hour: sp.hour,
        priceCents: sp.totalCents,
        payerUserId: null,
        payerName,
        method,
        providerChargeId: charge.id || `chr_wh_${Date.now()}`,
        amountCents: sp.amountPerSlotCents,
      });
    }
    return { received: true };
  }
}
