import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppConfig } from '../config/app.config';
import { DatabaseService } from '../database/database.service';
import { AvailabilityService, priceFor } from '../complexes/availability.service';
import { CulqiService } from '../integrations/culqi.service';
import { RealtimeBus, Rooms } from '../realtime/realtime.bus';
import { AuthUser } from '../common/types';
import { hourLabel, isValidDate, limaSlotStart, limaToday, toLimaSlot } from '../common/utils/time.util';
import { rethrowSlotConflict } from '../common/utils/pg-errors';
import { CreateBookingDto, PaySplitSlotDto, ReceptionBlockDto } from './dto/bookings.dto';

export const DEMO_ORGANIZER_ID = '00000000-0000-4000-a000-000000000021';
export const DEMO_OWNER_ID = '00000000-0000-4000-a000-000000000011';

@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsService.name);
  private expireTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly culqi: CulqiService,
    private readonly bus: RealtimeBus,
    private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.expireTimer = setInterval(() => {
      this.expireStaleHolds().catch((err) =>
        this.logger.warn(`Error al expirar reservas HELD vencidas: ${(err as Error).message}`),
      );
    }, 30_000);
    this.expireTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.expireTimer) clearInterval(this.expireTimer);
  }

  /**
   * Verifica que un usuario autenticado sea participante autorizado (`user_a_id`, `user_b_id` o `ADMIN`)
   * de un canal de contacto (`contact_relays`) antes de permitirle unirse a la sala de WebSocket `relay:<id>`.
   */
  async verifyRelayParticipant(relayId: string, user: AuthUser): Promise<void> {
    if (!user?.sub) {
      throw new UnauthorizedException('Sesión JWT requerida.');
    }
    const relay = await this.db.one<{
      id: string;
      userAId: string;
      userBId: string;
      expiresAt: Date;
    }>(
      `SELECT id, user_a_id AS "userAId", user_b_id AS "userBId", expires_at AS "expiresAt"
         FROM contact_relays WHERE id = $1`,
      [relayId],
    );
    if (!relay) {
      throw new NotFoundException('Canal seguro no encontrado.');
    }
    if (relay.userAId !== user.sub && relay.userBId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('No eres participante autorizado de este canal de contacto.');
    }
    if (new Date(relay.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('Esta sesión de contacto temporal ha expirado.');
    }
  }

  /**
   * Libera automáticamente cualquier reserva temporal (`HELD` / `PENDING_PAYMENT`)
   * cuyo `hold_expires_at` haya vencido, actualizando `bookings.status = 'EXPIRED'`,
   * `split_payments.status = 'EXPIRED'` y liberando el turno en tiempo real.
   */
  async expireStaleHolds(): Promise<number> {
    const stale = await this.db.query<{
      id: string;
      courtId: string;
      courtName: string;
      complexId: string;
      startsAt: Date;
      priceCents: number;
      shareToken: string | null;
    }>(
      `SELECT b.id, b.court_id AS "courtId", c.name AS "courtName", c.complex_id AS "complexId",
              b.starts_at AS "startsAt", b.total_cents AS "priceCents", sp.share_token AS "shareToken"
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         LEFT JOIN split_payments sp ON sp.booking_id = b.id
        WHERE b.status IN ('HELD', 'PENDING_PAYMENT')
          AND b.hold_expires_at IS NOT NULL
          AND b.hold_expires_at <= now()`,
    );

    if (!stale.length) return 0;

    for (const item of stale) {
      const { date, hour } = toLimaSlot(item.startsAt);
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE bookings
              SET status = 'EXPIRED'::booking_status,
                  updated_at = now()
            WHERE id = $1 AND status IN ('HELD', 'PENDING_PAYMENT')`,
          [item.id],
        );
        await tx.query(
          `UPDATE split_payments
              SET status = 'EXPIRED'::split_status,
                  reserved_slots = 0
            WHERE booking_id = $1 AND status = 'OPEN'`,
          [item.id],
        );
        await tx.query(
          `UPDATE payment_attempts
              SET status = 'FAILED',
                  error_code = 'HOLD_EXPIRED',
                  error_message = 'El tiempo de reserva temporal expiró antes de completarse el pago.',
                  updated_at = now()
            WHERE booking_id = $1 AND status IN ('INITIATED', 'PENDING')`,
          [item.id],
        );
        await tx.query(
          `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, payload)
           VALUES ($1, $2, 'EXPIRED', 'APP', $3::jsonb)`,
          [
            item.id,
            item.complexId,
            JSON.stringify({ hour, date, courtId: item.courtId, court: item.courtName }),
          ],
        );
      });

      this.bus.publish(Rooms.complex(item.complexId), 'slot:updated', {
        complexId: item.complexId,
        courtId: item.courtId,
        courtName: item.courtName,
        date,
        hour,
        label: hourLabel(hour),
        status: 'FREE',
        priceCents: item.priceCents,
      });

      this.bus.publish(Rooms.complex(item.complexId), 'feed:event', {
        eventType: 'EXPIRED',
        channel: 'APP',
        court: item.courtName,
        hour,
        date,
        createdAt: new Date().toISOString(),
        summary: `Expiración automática: turno liberado en ${item.courtName} (${hourLabel(hour)}) por tiempo agotado`,
      });
    }

    return stale.length;
  }

  /**
   * Reserva un turno desde la app móvil (`FULL_DEPOSIT` o `SPLIT`) resolviendo la carrera cobro vs. reserva:
   *  1. Valida `sourceId` y parámetros antes de tocar la pasarela.
   *  2. Bloquea atómicamente el turno en PostgreSQL insertando la reserva en `PENDING_PAYMENT`
   *     (protegida por `EXCLUDE USING gist (bookings_no_overlap)`), `split_payments` (`reserved_slots = 1`)
   *     y el registro de auditoría en `payment_attempts` (`status = 'INITIATED'`).
   *     Si otro cliente concurrente tomó el mismo turno en el mismo milisegundo, PostgreSQL rechaza
   *     el `INSERT` con `409 Conflict` ANTES de ejecutar cargo alguno en Culqi.
   *  3. Ejecuta el cargo con llave de idempotencia (`idempotencyKey`).
   *  4. Si el cargo es exitoso pero la confirmación en base de datos falla (o la reserva fue invalidada),
   *     ejecuta automáticamente la compensación mediante reembolso/anulación (`culqi.refundCharge`)
   *     dejando trazabilidad completa en `payment_attempts` (`REFUNDED` o `COMPENSATION_FAILED`).
   */
  async createBooking(dto: CreateBookingDto, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Debes iniciar sesión para realizar una reserva.');
    if (!isValidDate(dto.date)) throw new BadRequestException('Fecha inválida');

    // Validar formato de sourceId antes de reservar el turno en BD
    this.culqi.validateSourceId(dto.sourceId);

    await this.expireStaleHolds();

    const organizerId = user.sub;
    const court = await this.availability.getCourt(dto.courtId);

    if (court.verificationStatus !== 'VERIFIED') {
      throw new BadRequestException('Este complejo deportivo aún no cuenta con verificación aprobada.');
    }

    if (dto.hour < court.openHour || dto.hour >= court.closeHour) {
      throw new BadRequestException(`Horario fuera de atención (${court.openHour}:00 - ${court.closeHour}:00)`);
    }

    const startsAt = limaSlotStart(dto.date, dto.hour);
    const endsAt = limaSlotStart(dto.date, dto.hour + 1);
    const totalCents = priceFor(court, dto.hour);
    const isSplit = dto.paymentMode === 'SPLIT';
    const totalSlots = isSplit ? (dto.totalSlots ?? court.playersPerSide) : 1;
    const amountPerSlotCents = Math.ceil(totalCents / totalSlots);
    const depositCents = isSplit ? totalCents : Math.round(totalCents * 0.5);
    const chargeAmountCents = isSplit ? amountPerSlotCents : depositCents;
    const method = dto.method ?? 'YAPE';
    const payerName = dto.payerName?.trim() || user.name || 'Organizador';
    const idempotencyKey =
      dto.idempotencyKey?.trim() ||
      `bk_${organizerId}_${court.id}_${dto.date}_${dto.hour}_${randomBytes(6).toString('hex')}`;

    // Verificar idempotencia previa si el cliente envió idempotencyKey
    if (dto.idempotencyKey) {
      const existingAttempt = await this.db.one<{
        id: string;
        bookingId: string | null;
        status: string;
        providerChargeId: string | null;
        simulated: boolean;
      }>(
        `SELECT id, booking_id AS "bookingId", status, provider_charge_id AS "providerChargeId", simulated
           FROM payment_attempts WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existingAttempt?.status === 'SUCCEEDED' && existingAttempt.bookingId) {
        const existingBooking = await this.db.one<{
          id: string;
          status: string;
          channel: string;
          startsAt: string;
          endsAt: string;
          totalCents: number;
          depositCents: number;
          holdExpiresAt: string | null;
        }>(
          `SELECT id, status, channel, starts_at AS "startsAt", ends_at AS "endsAt",
                  total_cents AS "totalCents", deposit_cents AS "depositCents",
                  hold_expires_at AS "holdExpiresAt"
             FROM bookings WHERE id = $1`,
          [existingAttempt.bookingId],
        );
        if (existingBooking) {
          return {
            ...existingBooking,
            idempotentReplay: true,
            payment: {
              attemptId: existingAttempt.id,
              chargeId: existingAttempt.providerChargeId,
              status: 'succeeded',
              simulated: existingAttempt.simulated,
              amountCents: chargeAmountCents,
              method,
            },
            court: { id: court.id, name: court.name, complexId: court.complexId, complexName: court.complexName },
            date: dto.date,
            hour: dto.hour,
          };
        }
      }
    }

    const shareToken = `pk${randomBytes(5).toString('hex')}`;

    // PASO 1: Adquirir el bloqueo exclusivo del turno en PostgreSQL (PENDING_PAYMENT) ANTES de cobrar.
    // Si dos peticiones llegan al mismo milisegundo, EXCLUDE USING gist (bookings_no_overlap)
    // rechaza la segunda aquí mismo con 409 Conflict sin haber ejecutado ningún cargo en la pasarela.
    let prebooked: {
      bookingId: string;
      splitId: string;
      attemptId: string;
    };
    try {
      prebooked = await this.db.transaction(async (tx) => {
        const [b] = await tx.query<{ id: string }>(
          `INSERT INTO bookings (court_id, organizer_id, created_by, channel, status, payment_mode,
                                 starts_at, ends_at, total_cents, deposit_cents, notes, hold_expires_at)
           VALUES ($1, $2, $2, 'APP', 'PENDING_PAYMENT', $3::payment_mode, $4, $5, $6, $7, $8,
                   now() + INTERVAL '5 minutes')
           RETURNING id`,
          [
            court.id,
            organizerId,
            dto.paymentMode,
            startsAt.toISOString(),
            endsAt.toISOString(),
            totalCents,
            depositCents,
            dto.notes ?? null,
          ],
        );

        const [sp] = await tx.query<{ id: string }>(
          `INSERT INTO split_payments (booking_id, organizer_id, mode, total_slots, paid_slots, reserved_slots,
                                       amount_per_slot_cents, total_cents, share_token, status, expires_at)
           VALUES ($1, $2, $3::payment_mode, $4, 0, 1, $5, $6, $7, 'OPEN', now() + INTERVAL '30 minutes')
           RETURNING id`,
          [
            b.id,
            organizerId,
            dto.paymentMode,
            totalSlots,
            isSplit ? amountPerSlotCents : depositCents,
            totalCents,
            shareToken,
          ],
        );

        const [att] = await tx.query<{ id: string }>(
          `INSERT INTO payment_attempts (idempotency_key, booking_id, split_payment_id, user_id, payer_name,
                                         purpose, method, provider, source_id, amount_cents, currency, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::payment_method, 'CULQI', $8, $9, 'PEN', 'INITIATED', $10::jsonb)
           RETURNING id`,
          [
            idempotencyKey,
            b.id,
            sp.id,
            organizerId,
            payerName,
            isSplit ? 'SPLIT_INITIAL' : 'FULL_DEPOSIT',
            method,
            dto.sourceId.trim(),
            chargeAmountCents,
            JSON.stringify({
              courtId: court.id,
              date: dto.date,
              hour: dto.hour,
              paymentMode: dto.paymentMode,
              splitToken: shareToken,
            }),
          ],
        );

        return { bookingId: b.id, splitId: sp.id, attemptId: att.id };
      });
    } catch (err) {
      rethrowSlotConflict(err);
    }

    // PASO 2: Ejecutar el cargo en la pasarela enviando idempotencyKey
    const charge = await this.culqi.createCharge({
      amountCents: chargeAmountCents,
      email: `${organizerId.slice(0, 8)}@pichangabook.pe`,
      method,
      sourceId: dto.sourceId,
      idempotencyKey,
      description: isSplit
        ? `Cupo 1/${totalSlots} · ${court.name}`
        : `Adelanto 50% · ${court.name} (${hourLabel(dto.hour)})`,
      metadata: {
        attemptId: prebooked.attemptId,
        bookingId: prebooked.bookingId,
        courtId: court.id,
        date: dto.date,
        hour: String(dto.hour),
        paymentMode: dto.paymentMode,
        splitToken: shareToken,
        expectedAmountCents: String(chargeAmountCents),
      },
    });

    // Si el cargo fue rechazado por la pasarela, liberamos inmediatamente el turno PENDING_PAYMENT
    if (charge.status === 'failed') {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE payment_attempts
              SET status = 'FAILED',
                  provider_charge_id = $2,
                  simulated = $3,
                  error_code = 'PAYMENT_DECLINED',
                  error_message = $4,
                  updated_at = now()
            WHERE id = $1`,
          [prebooked.attemptId, charge.id, charge.simulated, charge.userMessage ?? 'Pago rechazado'],
        );
        await tx.query(
          `UPDATE split_payments SET status = 'CANCELLED', reserved_slots = 0 WHERE id = $1`,
          [prebooked.splitId],
        );
        await tx.query(
          `UPDATE bookings SET status = 'CANCELLED', hold_expires_at = NULL, updated_at = now() WHERE id = $1`,
          [prebooked.bookingId],
        );
      });
      throw new BadRequestException({
        code: 'PAYMENT_DECLINED',
        message: charge.userMessage ?? 'El pago fue rechazado por la pasarela.',
        attemptId: prebooked.attemptId,
      });
    }

    // Si el cargo quedó en estado PENDING, conservamos el turno en PENDING_PAYMENT (y reserved_slots = 1)
    // para que el webhook de Culqi lo concilie y acredite cuando la billetera confirme.
    if (charge.status === 'pending') {
      const pendingBooking = await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE payment_attempts
              SET status = 'PENDING',
                  provider_charge_id = $2,
                  simulated = $3,
                  updated_at = now()
            WHERE id = $1`,
          [prebooked.attemptId, charge.id, charge.simulated],
        );
        const [b] = await tx.query<{
          id: string;
          status: string;
          channel: string;
          startsAt: string;
          endsAt: string;
          totalCents: number;
          depositCents: number;
          holdExpiresAt: string | null;
        }>(
          `SELECT id, status, channel, starts_at AS "startsAt", ends_at AS "endsAt",
                  total_cents AS "totalCents", deposit_cents AS "depositCents",
                  hold_expires_at AS "holdExpiresAt"
             FROM bookings WHERE id = $1`,
          [prebooked.bookingId],
        );
        return b;
      });

      return {
        ...pendingBooking,
        payment: {
          attemptId: prebooked.attemptId,
          chargeId: charge.id,
          status: 'pending',
          simulated: charge.simulated,
          amountCents: chargeAmountCents,
          method,
        },
        court: { id: court.id, name: court.name, complexId: court.complexId, complexName: court.complexName },
        date: dto.date,
        hour: dto.hour,
        split: {
          id: prebooked.splitId,
          shareToken,
          totalSlots,
          paidSlots: 0,
          amountPerSlotCents: isSplit ? amountPerSlotCents : depositCents,
          status: 'OPEN',
        },
      };
    }

    // PASO 3: El cargo fue exitoso (`succeeded`). Confirmamos la reserva o ejecutamos compensación si falla.
    const targetBookingStatus = isSplit ? 'HELD' : 'CONFIRMED';

    try {
      const finalized = await this.db.transaction(async (tx) => {
        if (dto.simulatePostChargeConflict && this.cfg.demoMode) {
          throw new Error('SIMULATED_POST_CHARGE_DB_CONFLICT');
        }

        const [lockedBooking] = await tx.query<{ id: string; status: string }>(
          `SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE`,
          [prebooked.bookingId],
        );
        if (!lockedBooking || lockedBooking.status !== 'PENDING_PAYMENT') {
          throw new Error(`BOOKING_INVALID_STATE_${lockedBooking?.status ?? 'MISSING'}`);
        }

        const holdExpiresAt =
          targetBookingStatus === 'HELD' ? new Date(Date.now() + 30 * 60_000).toISOString() : null;
        const [booking] = await tx.query<{
          id: string;
          status: string;
          channel: string;
          startsAt: string;
          endsAt: string;
          totalCents: number;
          depositCents: number;
          holdExpiresAt: string | null;
        }>(
          `UPDATE bookings
              SET status = $2::booking_status,
                  hold_expires_at = $3::timestamptz,
                  updated_at = now()
            WHERE id = $1
            RETURNING id, status, channel, starts_at AS "startsAt", ends_at AS "endsAt",
                      total_cents AS "totalCents", deposit_cents AS "depositCents",
                      hold_expires_at AS "holdExpiresAt"`,
          [prebooked.bookingId, targetBookingStatus, holdExpiresAt],
        );

        const nextSplitStatus = totalSlots === 1 ? 'COMPLETED' : 'OPEN';
        const completedAt = totalSlots === 1 ? new Date().toISOString() : null;
        const [sp] = await tx.query<{
          id: string;
          shareToken: string;
          totalSlots: number;
          paidSlots: number;
          amountPerSlotCents: number;
          status: string;
        }>(
          `UPDATE split_payments
              SET paid_slots = 1,
                  reserved_slots = 0,
                  status = $2::split_status,
                  completed_at = $3::timestamptz
            WHERE id = $1
            RETURNING id, share_token AS "shareToken", total_slots AS "totalSlots",
                      paid_slots AS "paidSlots", amount_per_slot_cents AS "amountPerSlotCents", status`,
          [prebooked.splitId, nextSplitStatus, completedAt],
        );

        await tx.query(
          `INSERT INTO payment_shares (split_payment_id, attempt_id, payer_user_id, payer_name, method, provider, provider_charge_id, amount_cents, status)
           VALUES ($1, $2, $3, $4, $5::payment_method, 'CULQI', $6, $7, 'PAID')`,
          [prebooked.splitId, prebooked.attemptId, organizerId, payerName, method, charge.id, chargeAmountCents],
        );

        await tx.query(
          `UPDATE payment_attempts
              SET status = 'SUCCEEDED',
                  provider_charge_id = $2,
                  simulated = $3,
                  updated_at = now()
            WHERE id = $1`,
          [prebooked.attemptId, charge.id, charge.simulated],
        );

        await tx.query(
          `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload)
           VALUES ($1, $2, $3, 'APP', $4, $5::jsonb)`,
          [
            booking.id,
            court.complexId,
            targetBookingStatus === 'CONFIRMED' ? 'CONFIRMED' : 'CREATED',
            organizerId,
            JSON.stringify({
              hour: dto.hour,
              date: dto.date,
              courtId: court.id,
              court: court.name,
              mode: dto.paymentMode,
              attemptId: prebooked.attemptId,
              chargeId: charge.id,
              chargeStatus: charge.status,
              paid: 1,
              total: totalSlots,
            }),
          ],
        );

        return { booking, splitInfo: isSplit ? sp : null };
      });

      const slotPayload = {
        complexId: court.complexId,
        courtId: court.id,
        courtName: court.name,
        date: dto.date,
        hour: dto.hour,
        label: hourLabel(dto.hour),
        status: finalized.booking.status,
        channel: 'APP',
        bookingId: finalized.booking.id,
        priceCents: totalCents,
        holdExpiresAt: finalized.booking.holdExpiresAt,
        split: finalized.splitInfo
          ? {
              paid: finalized.splitInfo.paidSlots,
              total: finalized.splitInfo.totalSlots,
              mode: 'SPLIT',
              shareToken: finalized.splitInfo.shareToken,
            }
          : undefined,
      };

      this.bus.publish(Rooms.complex(court.complexId), 'slot:updated', slotPayload);
      this.bus.publish(Rooms.complex(court.complexId), 'feed:event', {
        eventType: targetBookingStatus === 'CONFIRMED' ? 'CONFIRMED' : 'CREATED',
        channel: 'APP',
        court: court.name,
        hour: dto.hour,
        date: dto.date,
        createdAt: new Date().toISOString(),
        summary: isSplit
          ? `App Móvil: Split Payment iniciado (1/${totalSlots}) en ${court.name} (${hourLabel(dto.hour)})`
          : `App Móvil: Reserva confirmada en ${court.name} (${hourLabel(dto.hour)})`,
      });

      return {
        ...finalized.booking,
        payment: {
          attemptId: prebooked.attemptId,
          chargeId: charge.id,
          status: charge.status,
          simulated: charge.simulated,
          amountCents: chargeAmountCents,
          method,
        },
        court: { id: court.id, name: court.name, complexId: court.complexId, complexName: court.complexName },
        date: dto.date,
        hour: dto.hour,
        split: finalized.splitInfo
          ? {
              ...finalized.splitInfo,
              whatsappUrl: this.buildWhatsappShareUrl(
                finalized.splitInfo.shareToken,
                court.complexName,
                court.name,
                dto.date,
                dto.hour,
                finalized.splitInfo.amountPerSlotCents,
              ),
            }
          : null,
      };
    } catch (confirmErr) {
      // PASO 4 (Compensación Automática): Si ocurrió un fallo tras haber cobrado en pasarela,
      // anulamos/reembolsamos el cargo y registramos el estado en payment_attempts y payment_shares.
      const compensation = await this.compensateBookingCharge({
        attemptId: prebooked.attemptId,
        bookingId: prebooked.bookingId,
        splitId: prebooked.splitId,
        payerUserId: organizerId,
        payerName,
        method,
        chargeId: charge.id,
        amountCents: chargeAmountCents,
        simulatedCharge: charge.simulated,
        reason: (confirmErr as Error).message || 'BOOKING_CONFIRMATION_FAILED',
      });

      throw new ConflictException({
        code: 'BOOKING_CHARGE_COMPENSATED',
        message:
          compensation.compensationStatus === 'REFUNDED'
            ? 'No se pudo confirmar la reserva; el cargo fue revertido/reembolsado automáticamente.'
            : 'No se pudo confirmar la reserva; el cargo quedó registrado para conciliación prioritaria.',
        attemptId: prebooked.attemptId,
        chargeId: charge.id,
        compensationStatus: compensation.compensationStatus,
        refundId: compensation.refundId,
        simulated: compensation.simulated,
        compensation: {
          status: compensation.compensationStatus,
          refundId: compensation.refundId,
          simulated: compensation.simulated,
        },
      });
    }
  }

  private async compensateBookingCharge(params: {
    attemptId: string;
    bookingId: string;
    splitId: string;
    payerUserId: string;
    payerName: string;
    method: 'CARD' | 'YAPE' | 'PLIN';
    chargeId: string;
    amountCents: number;
    simulatedCharge: boolean;
    reason: string;
  }): Promise<{
    compensationStatus: 'REFUNDED' | 'COMPENSATION_FAILED';
    refundId: string | null;
    simulated: boolean;
  }> {
    await this.db.query(
      `UPDATE payment_attempts
          SET status = 'COMPENSATING',
              provider_charge_id = $2,
              simulated = $3,
              error_code = 'BOOKING_CONFIRMATION_FAILED',
              error_message = $4,
              updated_at = now()
        WHERE id = $1`,
      [params.attemptId, params.chargeId, params.simulatedCharge, params.reason],
    );

    const refund = await this.culqi.refundCharge({
      chargeId: params.chargeId,
      amountCents: params.amountCents,
      reason: 'solicitud_comprador',
      idempotencyKey: `refund_attempt_${params.attemptId}`,
    });

    const compensationStatus: 'REFUNDED' | 'COMPENSATION_FAILED' =
      refund.status === 'succeeded' ? 'REFUNDED' : 'COMPENSATION_FAILED';
    const shareStatus = compensationStatus === 'REFUNDED' ? 'REFUNDED' : 'FAILED';
    const refundedAt = compensationStatus === 'REFUNDED' ? new Date().toISOString() : null;

    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE bookings SET status = 'CANCELLED', hold_expires_at = NULL, updated_at = now() WHERE id = $1`,
        [params.bookingId],
      );
      await tx.query(
        `UPDATE split_payments SET status = 'CANCELLED', reserved_slots = 0 WHERE id = $1`,
        [params.splitId],
      );
      await tx.query(
        `UPDATE payment_attempts
            SET status = $2,
                refund_id = $3,
                refund_reason = $4,
                refunded_at = $5::timestamptz,
                error_message = $6,
                updated_at = now()
          WHERE id = $1`,
        [params.attemptId, compensationStatus, refund.id, params.reason, refundedAt, refund.userMessage],
      );
      await tx.query(
        `INSERT INTO payment_shares (split_payment_id, attempt_id, payer_user_id, payer_name, method, provider,
                                     provider_charge_id, amount_cents, status, refund_id, refund_reason, refunded_at)
         VALUES ($1, $2, $3, $4, $5::payment_method, 'CULQI', $6, $7,
                 $8::share_status, $9, $10, $11::timestamptz)
         ON CONFLICT (provider_charge_id) DO NOTHING`,
        [
          params.splitId,
          params.attemptId,
          params.payerUserId,
          params.payerName,
          params.method,
          params.chargeId,
          params.amountCents,
          shareStatus,
          refund.id,
          params.reason,
          refundedAt,
        ],
      );
    });

    return {
      compensationStatus,
      refundId: refund.id,
      simulated: refund.simulated,
    };
  }

  /**
   * Historial de reservas del usuario autenticado (como organizador o participante de Split Payment).
   */
  async myBookings(userId: string) {
    await this.expireStaleHolds();
    const rows = await this.db.query<{
      id: string;
      courtId: string;
      courtName: string;
      complexId: string;
      complexName: string;
      districtName: string;
      status: string;
      channel: string;
      paymentMode: string;
      startsAt: Date;
      endsAt: Date;
      totalCents: number;
      depositCents: number;
      holdExpiresAt: string | null;
      shareToken: string | null;
      paidSlots: number | null;
      totalSlots: number | null;
      splitStatus: string | null;
      createdAt: string;
    }>(
      `SELECT DISTINCT b.id, b.court_id AS "courtId", c.name AS "courtName",
              x.id AS "complexId", x.name AS "complexName", d.name AS "districtName",
              b.status, b.channel, b.payment_mode AS "paymentMode",
              b.starts_at AS "startsAt", b.ends_at AS "endsAt",
              b.total_cents AS "totalCents", b.deposit_cents AS "depositCents",
              b.hold_expires_at AS "holdExpiresAt",
              sp.share_token AS "shareToken", sp.paid_slots AS "paidSlots",
              sp.total_slots AS "totalSlots", sp.status AS "splitStatus",
              b.created_at AS "createdAt"
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         JOIN complexes x ON x.id = c.complex_id
         JOIN districts d ON d.code = x.district_code
         LEFT JOIN split_payments sp ON sp.booking_id = b.id
         LEFT JOIN payment_shares ps ON ps.split_payment_id = sp.id
        WHERE b.organizer_id = $1 OR ps.payer_user_id = $1
        ORDER BY b.starts_at DESC
        LIMIT 50`,
      [userId],
    );

    return rows.map((r) => {
      const { date, hour } = toLimaSlot(r.startsAt);
      return {
        ...r,
        date,
        hour,
        hourLabel: hourLabel(hour),
      };
    });
  }

  /**
   * Bloqueo rápido desde el Panel Web de Recepción (ventas presenciales o telefónicas).
   * Verifica que el usuario autenticado sea el dueño del complejo deportivo.
   */
  async receptionBlock(dto: ReceptionBlockDto, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión como propietario del complejo.');
    if (!isValidDate(dto.date)) throw new BadRequestException('Fecha inválida');

    await this.expireStaleHolds();

    const court = await this.availability.getCourt(dto.courtId);
    if (court.ownerId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('No tienes permisos para bloquear canchas en este complejo deportivo.');
    }

    if (dto.hour < court.openHour || dto.hour >= court.closeHour) {
      throw new BadRequestException(`Horario fuera de atención (${court.openHour}:00 - ${court.closeHour}:00)`);
    }

    const startsAt = limaSlotStart(dto.date, dto.hour);
    const endsAt = limaSlotStart(dto.date, dto.hour + 1);
    const totalCents = priceFor(court, dto.hour);
    const channel = dto.channel ?? 'RECEPTION';
    const customerName = dto.customerName?.trim() || 'Venta presencial en recepción';

    try {
      const booking = await this.db.transaction(async (tx) => {
        const [b] = await tx.query<{
          id: string;
          status: string;
          channel: string;
          customerName: string;
          notes: string | null;
        }>(
          `INSERT INTO bookings (court_id, created_by, channel, status, starts_at, ends_at,
                                 total_cents, deposit_cents, customer_name, notes)
           VALUES ($1, $2, $3::booking_channel, 'BLOCKED', $4, $5, $6, $6, $7, $8)
           RETURNING id, status, channel, customer_name AS "customerName", notes`,
          [court.id, user.sub, channel, startsAt.toISOString(), endsAt.toISOString(), totalCents, customerName, dto.notes ?? null],
        );

        await tx.query(
          `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload)
           VALUES ($1, $2, 'BLOCKED', $3::booking_channel, $4, $5::jsonb)`,
          [
            b.id,
            court.complexId,
            channel,
            user.sub,
            JSON.stringify({
              hour: dto.hour,
              date: dto.date,
              courtId: court.id,
              court: court.name,
              customerName,
            }),
          ],
        );
        return b;
      });

      const slotPayload = {
        complexId: court.complexId,
        courtId: court.id,
        courtName: court.name,
        date: dto.date,
        hour: dto.hour,
        label: hourLabel(dto.hour),
        status: 'BLOCKED',
        channel,
        bookingId: booking.id,
        customerName: booking.customerName,
        notes: booking.notes,
        priceCents: totalCents,
      };

      this.bus.publish(Rooms.complex(court.complexId), 'slot:updated', slotPayload);
      this.bus.publish(Rooms.complex(court.complexId), 'feed:event', {
        eventType: 'BLOCKED',
        channel,
        court: court.name,
        hour: dto.hour,
        date: dto.date,
        customerName,
        createdAt: new Date().toISOString(),
        summary: `Recepción (${channel}): Bloqueo en ${court.name} · ${hourLabel(dto.hour)} (${customerName})`,
      });

      return slotPayload;
    } catch (err) {
      rethrowSlotConflict(err);
    }
  }

  /**
   * Libera un turno bloqueado o cancela una reserva antes de su inicio.
   * Sólo puede ejecutarlo el dueño del complejo, el organizador titular de la reserva o un ADMIN.
   */
  async releaseBooking(bookingId: string, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para liberar o cancelar una reserva.');

    const existing = await this.db.one<{
      id: string;
      organizerId: string | null;
      ownerId: string;
      courtId: string;
      courtName: string;
      complexId: string;
      startsAt: Date;
      priceCents: number;
    }>(
      `SELECT b.id, b.organizer_id AS "organizerId", x.owner_id AS "ownerId",
              b.court_id AS "courtId", c.name AS "courtName", c.complex_id AS "complexId",
              b.starts_at AS "startsAt", b.total_cents AS "priceCents"
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         JOIN complexes x ON x.id = c.complex_id
        WHERE b.id = $1`,
      [bookingId],
    );
    if (!existing) throw new NotFoundException('Reserva/bloqueo no encontrado');

    const isOwner = existing.ownerId === user.sub;
    const isOrganizer = existing.organizerId !== null && existing.organizerId === user.sub;
    if (!isOwner && !isOrganizer && user.role !== 'ADMIN') {
      throw new ForbiddenException('Sólo el propietario del complejo o el organizador titular pueden cancelar este turno.');
    }

    const { date, hour } = toLimaSlot(existing.startsAt);

    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE bookings SET status = 'CANCELLED', hold_expires_at = NULL, updated_at = now() WHERE id = $1`,
        [bookingId],
      );
      await tx.query(
        `UPDATE split_payments SET status = 'CANCELLED', reserved_slots = 0 WHERE booking_id = $1 AND status = 'OPEN'`,
        [bookingId],
      );
      await tx.query(
        `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload)
         VALUES ($1, $2, 'RELEASED', $3::booking_channel, $4, $5::jsonb)`,
        [
          bookingId,
          existing.complexId,
          isOwner ? 'RECEPTION' : 'APP',
          user.sub,
          JSON.stringify({ hour, date, courtId: existing.courtId, court: existing.courtName }),
        ],
      );
    });

    const slotPayload = {
      complexId: existing.complexId,
      courtId: existing.courtId,
      courtName: existing.courtName,
      date,
      hour,
      label: hourLabel(hour),
      status: 'FREE',
      bookingId: undefined,
      priceCents: existing.priceCents,
    };

    this.bus.publish(Rooms.complex(existing.complexId), 'slot:updated', slotPayload);
    this.bus.publish(Rooms.complex(existing.complexId), 'feed:event', {
      eventType: 'RELEASED',
      channel: isOwner ? 'RECEPTION' : 'APP',
      court: existing.courtName,
      hour,
      date,
      createdAt: new Date().toISOString(),
      summary: `Turno liberado en ${existing.courtName} · ${hourLabel(hour)}`,
    });

    return slotPayload;
  }

  // ---------------------------------------------------------------------------
  // Split Payment (link de cobro fraccionado para WhatsApp + coordinación de cupos)
  // ---------------------------------------------------------------------------
  async getSplitByToken(token: string) {
    await this.expireStaleHolds();

    const sp = await this.db.one<{
      id: string;
      bookingId: string;
      shareToken: string;
      mode: string;
      totalSlots: number;
      paidSlots: number;
      reservedSlots: number;
      amountPerSlotCents: number;
      totalCents: number;
      status: string;
      expiresAt: string;
      completedAt: string | null;
      bookingStatus: string;
      startsAt: Date;
      courtId: string;
      courtName: string;
      complexId: string;
      complexName: string;
      districtName: string;
      organizerName: string;
      organizerPhoneMasked: string;
    }>(
      `SELECT sp.id, sp.booking_id AS "bookingId", sp.share_token AS "shareToken", sp.mode,
              sp.total_slots AS "totalSlots", sp.paid_slots AS "paidSlots",
              sp.reserved_slots AS "reservedSlots",
              sp.amount_per_slot_cents AS "amountPerSlotCents", sp.total_cents AS "totalCents",
              sp.status, sp.expires_at AS "expiresAt", sp.completed_at AS "completedAt",
              b.status AS "bookingStatus", b.starts_at AS "startsAt",
              c.id AS "courtId", c.name AS "courtName",
              x.id AS "complexId", x.name AS "complexName", d.name AS "districtName",
              u.full_name AS "organizerName", u.phone_masked AS "organizerPhoneMasked"
         FROM split_payments sp
         JOIN bookings b ON b.id = sp.booking_id
         JOIN courts c ON c.id = b.court_id
         JOIN complexes x ON x.id = c.complex_id
         JOIN districts d ON d.code = x.district_code
         JOIN users u ON u.id = sp.organizer_id
        WHERE sp.share_token = $1`,
      [token],
    );
    if (!sp) throw new NotFoundException('Link de pago dividido no encontrado');

    const shares = await this.db.query(
      `SELECT id, payer_name AS "payerName", method, provider, provider_charge_id AS "providerChargeId",
              amount_cents AS "amountCents", status, refund_id AS "refundId", refund_reason AS "refundReason",
              paid_at AS "paidAt"
         FROM payment_shares
        WHERE split_payment_id = $1
        ORDER BY paid_at ASC`,
      [sp.id],
    );

    const { date, hour } = toLimaSlot(sp.startsAt);
    return {
      ...sp,
      date,
      hour,
      hourLabel: hourLabel(hour),
      progressLabel: `Cupos pagados: ${sp.paidSlots} de ${sp.totalSlots}`,
      remainingSlots: Math.max(0, sp.totalSlots - sp.paidSlots),
      availableToReserveSlots: Math.max(0, sp.totalSlots - sp.paidSlots - sp.reservedSlots),
      whatsappUrl: this.buildWhatsappShareUrl(
        sp.shareToken,
        sp.complexName,
        sp.courtName,
        date,
        hour,
        sp.amountPerSlotCents,
      ),
      shares,
    };
  }

  /**
   * Procesa el pago de 1 cupo en el Split Payment coordinando concurrencia:
   *  1. Valida `sourceId` y bloquea `split_payments FOR UPDATE` para verificar que
   *     `paid_slots + reserved_slots < total_slots`. Si varios usuarios intentan pagar
   *     el último cupo simultáneamente, sólo uno reserva el cupo (`reserved_slots + 1`)
   *     y pasa a la pasarela; los demás son rechazados con `409 Conflict` SIN generar cargos excedentes.
   *  2. Registra el intento en `payment_attempts`.
   *  3. Si un cargo llegara por carrera externa o tras vencimiento, `recordVerifiedShare()`
   *     ejecuta automáticamente la compensación (`culqi.refundCharge`) y deja trazabilidad.
   */
  async paySplitSlot(token: string, dto: PaySplitSlotDto, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión para abonar tu cupo.');

    this.culqi.validateSourceId(dto.sourceId);
    await this.expireStaleHolds();

    const payerName = dto.payerName.trim();
    const idempotencyKey =
      dto.idempotencyKey?.trim() || `sp_${token}_${user.sub}_${randomBytes(6).toString('hex')}`;

    if (dto.idempotencyKey) {
      const existingAttempt = await this.db.one<{
        id: string;
        status: string;
        providerChargeId: string | null;
        simulated: boolean;
      }>(
        `SELECT id, status, provider_charge_id AS "providerChargeId", simulated
           FROM payment_attempts WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existingAttempt?.status === 'SUCCEEDED') {
        const current = await this.getSplitByToken(token);
        return {
          ...current,
          paymentStatus: 'SUCCEEDED',
          attemptId: existingAttempt.id,
          chargeId: existingAttempt.providerChargeId,
          simulated: existingAttempt.simulated,
          idempotentReplay: true,
        };
      }
    }

    // PASO 1: Bloquear `split_payments FOR UPDATE`, verificar cupo libre y reservar 1 cupo (`reserved_slots + 1`)
    const reservation = await this.db.transaction(async (tx) => {
      const [sp] = await tx.query<{
        id: string;
        bookingId: string;
        shareToken: string;
        totalSlots: number;
        paidSlots: number;
        reservedSlots: number;
        amountPerSlotCents: number;
        totalCents: number;
        status: string;
        bookingStatus: string;
        holdExpiresAt: Date | null;
        startsAt: Date;
        courtId: string;
        courtName: string;
        complexId: string;
      }>(
        `SELECT sp.id, sp.booking_id AS "bookingId", sp.share_token AS "shareToken",
                sp.total_slots AS "totalSlots", sp.paid_slots AS "paidSlots",
                sp.reserved_slots AS "reservedSlots",
                sp.amount_per_slot_cents AS "amountPerSlotCents", sp.total_cents AS "totalCents",
                sp.status, b.status AS "bookingStatus", b.hold_expires_at AS "holdExpiresAt",
                b.starts_at AS "startsAt", c.id AS "courtId", c.name AS "courtName",
                c.complex_id AS "complexId"
           FROM split_payments sp
           JOIN bookings b ON b.id = sp.booking_id
           JOIN courts c ON c.id = b.court_id
          WHERE sp.share_token = $1
            FOR UPDATE OF sp, b`,
        [token],
      );
      if (!sp) throw new NotFoundException('Link de pago dividido no encontrado');

      const holdExpired = sp.holdExpiresAt && new Date(sp.holdExpiresAt).getTime() <= Date.now();
      if (
        sp.status === 'EXPIRED' ||
        sp.status === 'CANCELLED' ||
        sp.bookingStatus === 'EXPIRED' ||
        sp.bookingStatus === 'CANCELLED' ||
        holdExpired
      ) {
        throw new ConflictException({
          code: 'SPLIT_EXPIRED_OR_CANCELLED',
          message: 'Esta reserva dividida ha expirado o fue cancelada.',
        });
      }

      if (sp.status === 'COMPLETED' || sp.paidSlots >= sp.totalSlots) {
        throw new ConflictException({
          code: 'SPLIT_ALREADY_COMPLETED',
          message: 'Todos los cupos de esta pichanga ya están pagados.',
        });
      }

      if (sp.paidSlots + sp.reservedSlots >= sp.totalSlots) {
        throw new ConflictException({
          code: 'SPLIT_SLOTS_FULL',
          message: 'El último cupo disponible ya está siendo procesado por otro jugador. No se realizó ningún cobro.',
        });
      }

      await tx.query(
        `UPDATE split_payments SET reserved_slots = reserved_slots + 1 WHERE id = $1`,
        [sp.id],
      );

      const { date, hour } = toLimaSlot(sp.startsAt);
      const [att] = await tx.query<{ id: string }>(
        `INSERT INTO payment_attempts (idempotency_key, booking_id, split_payment_id, user_id, payer_name,
                                       purpose, method, provider, source_id, amount_cents, currency, status, metadata)
         VALUES ($1, $2, $3, $4, $5, 'SPLIT_SLOT', $6::payment_method, 'CULQI', $7, $8, 'PEN', 'INITIATED', $9::jsonb)
         RETURNING id`,
        [
          idempotencyKey,
          sp.bookingId,
          sp.id,
          user.sub,
          payerName,
          dto.method,
          dto.sourceId.trim(),
          sp.amountPerSlotCents,
          JSON.stringify({
            splitToken: token,
            bookingId: sp.bookingId,
            payerName,
            expectedAmountCents: sp.amountPerSlotCents,
          }),
        ],
      );

      return { ...sp, date, hour, attemptId: att.id };
    });

    // PASO 2: Ejecutar el cargo en la pasarela Culqi con llave de idempotencia
    const charge = await this.culqi.createCharge({
      amountCents: reservation.amountPerSlotCents,
      email: `${user.sub.slice(0, 8)}@pichangabook.pe`,
      method: dto.method,
      sourceId: dto.sourceId,
      idempotencyKey,
      description: `Cupo pichanga · ${reservation.courtName} (${hourLabel(reservation.hour)})`,
      metadata: {
        attemptId: reservation.attemptId,
        splitToken: token,
        bookingId: reservation.bookingId,
        payerName,
        expectedAmountCents: String(reservation.amountPerSlotCents),
      },
    });

    if (charge.status === 'failed') {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE split_payments SET reserved_slots = GREATEST(0, reserved_slots - 1) WHERE id = $1`,
          [reservation.id],
        );
        await tx.query(
          `UPDATE payment_attempts
              SET status = 'FAILED',
                  provider_charge_id = $2,
                  simulated = $3,
                  error_code = 'PAYMENT_DECLINED',
                  error_message = $4,
                  updated_at = now()
            WHERE id = $1`,
          [reservation.attemptId, charge.id, charge.simulated, charge.userMessage ?? 'Pago rechazado'],
        );
      });
      throw new BadRequestException({
        code: 'PAYMENT_DECLINED',
        message: charge.userMessage ?? 'El pago fue rechazado por la pasarela.',
        attemptId: reservation.attemptId,
      });
    }

    if (charge.status === 'pending') {
      await this.db.query(
        `UPDATE payment_attempts
            SET status = 'PENDING',
                provider_charge_id = $2,
                simulated = $3,
                updated_at = now()
          WHERE id = $1`,
        [reservation.attemptId, charge.id, charge.simulated],
      );
      const current = await this.getSplitByToken(token);
      return {
        ...current,
        paymentStatus: 'PENDING',
        attemptId: reservation.attemptId,
        chargeId: charge.id,
        message: charge.userMessage ?? 'Pago pendiente de confirmación por la pasarela.',
      };
    }

    // PASO 3: Acreditar el cupo verificado (o compensar mediante reembolso si el split venció/se llenó)
    const shareResult = await this.recordVerifiedShare({
      splitId: reservation.id,
      bookingId: reservation.bookingId,
      complexId: reservation.complexId,
      courtId: reservation.courtId,
      courtName: reservation.courtName,
      date: reservation.date,
      hour: reservation.hour,
      priceCents: reservation.totalCents,
      payerUserId: user.sub,
      payerName,
      method: dto.method,
      providerChargeId: charge.id,
      amountCents: reservation.amountPerSlotCents,
      attemptId: reservation.attemptId,
      reservedSlotHeld: true,
      simulated: charge.simulated,
    });

    const refreshed = await this.getSplitByToken(token);
    return {
      ...refreshed,
      paymentStatus: shareResult.refunded ? 'REFUNDED' : 'SUCCEEDED',
      attemptId: reservation.attemptId,
      chargeId: charge.id,
      refundId: shareResult.refundId ?? null,
      simulated: charge.simulated,
    };
  }

  /**
   * Registra un abono verificado de pasarela de forma estrictamente idempotente
   * (por `provider_charge_id`) y coordina el cupo con bloqueo `FOR UPDATE`.
   * Si el split ya estaba lleno (`paid_slots >= total_slots`) o fue cancelado/expirado
   * cuando llega el cargo (p.ej. un webhook asíncrono excedente), ejecuta automáticamente
   * el reembolso compensatorio (`culqi.refundCharge`) y registra el cargo como `REFUNDED`.
   */
  async recordVerifiedShare(params: {
    splitId: string;
    bookingId: string;
    complexId: string;
    courtId: string;
    courtName: string;
    date: string;
    hour: number;
    priceCents: number;
    payerUserId: string | null;
    payerName: string;
    method: 'CARD' | 'YAPE' | 'PLIN';
    providerChargeId: string;
    amountCents: number;
    attemptId?: string | null;
    reservedSlotHeld?: boolean;
    simulated?: boolean;
  }): Promise<{
    id: string;
    shareToken: string;
    paidSlots: number;
    totalSlots: number;
    status: string;
    completed: boolean;
    duplicate: boolean;
    refunded?: boolean;
    refundId?: string | null;
    compensationStatus?: 'REFUNDED' | 'COMPENSATION_FAILED';
  }> {
    // 1. Comprobación rápida de idempotencia y estado bajo bloqueo FOR UPDATE
    const txOutcome = await this.db.transaction(async (tx) => {
      const [locked] = await tx.query<{
        id: string;
        shareToken: string;
        paidSlots: number;
        reservedSlots: number;
        totalSlots: number;
        status: string;
        bookingStatus: string;
      }>(
        `SELECT sp.id, sp.share_token AS "shareToken", sp.paid_slots AS "paidSlots",
                sp.reserved_slots AS "reservedSlots", sp.total_slots AS "totalSlots",
                sp.status, b.status AS "bookingStatus"
           FROM split_payments sp
           JOIN bookings b ON b.id = sp.booking_id
          WHERE sp.id = $1
            FOR UPDATE OF sp, b`,
        [params.splitId],
      );
      if (!locked) throw new NotFoundException('Split payment no encontrado');

      const existingShare = await tx.query<{ id: string; status: string; refundId: string | null }>(
        `SELECT id, status, refund_id AS "refundId" FROM payment_shares WHERE provider_charge_id = $1`,
        [params.providerChargeId],
      );
      if (existingShare.length > 0) {
        return {
          ...locked,
          completed: locked.status === 'COMPLETED',
          duplicate: true,
          needsOverflowRefund: false,
          refunded: existingShare[0].status === 'REFUNDED',
          refundId: existingShare[0].refundId,
        };
      }

      const splitClosedOrFull =
        locked.status !== 'OPEN' ||
        locked.bookingStatus === 'CANCELLED' ||
        locked.bookingStatus === 'EXPIRED' ||
        locked.paidSlots >= locked.totalSlots;

      if (splitClosedOrFull) {
        if (params.reservedSlotHeld) {
          await tx.query(
            `UPDATE split_payments SET reserved_slots = GREATEST(0, reserved_slots - 1) WHERE id = $1`,
            [params.splitId],
          );
        }
        return {
          ...locked,
          completed: locked.paidSlots >= locked.totalSlots,
          duplicate: false,
          needsOverflowRefund: true,
        };
      }

      const newPaid = locked.paidSlots + 1;
      const completed = newPaid >= locked.totalSlots;
      const nextReserved = completed
        ? 0
        : params.reservedSlotHeld
          ? Math.max(0, locked.reservedSlots - 1)
          : Math.min(locked.reservedSlots, locked.totalSlots - newPaid);

      await tx.query(
        `INSERT INTO payment_shares (split_payment_id, attempt_id, payer_user_id, payer_name, method, provider, provider_charge_id, amount_cents, status)
         VALUES ($1, $2, $3, $4, $5::payment_method, 'CULQI', $6, $7, 'PAID')`,
        [
          params.splitId,
          params.attemptId ?? null,
          params.payerUserId,
          params.payerName,
          params.method,
          params.providerChargeId,
          params.amountCents,
        ],
      );

      const [spAfter] = await tx.query<{
        id: string;
        shareToken: string;
        paidSlots: number;
        totalSlots: number;
        status: string;
      }>(
        `UPDATE split_payments
            SET paid_slots = $2,
                reserved_slots = $3,
                status = CASE WHEN $4::boolean THEN 'COMPLETED'::split_status ELSE status END,
                completed_at = CASE WHEN $4::boolean THEN now() ELSE completed_at END
          WHERE id = $1
          RETURNING id, share_token AS "shareToken", paid_slots AS "paidSlots",
                    total_slots AS "totalSlots", status`,
        [params.splitId, newPaid, nextReserved, completed],
      );

      if (completed) {
        await tx.query(
          `UPDATE bookings SET status = 'CONFIRMED', hold_expires_at = NULL, updated_at = now() WHERE id = $1`,
          [params.bookingId],
        );
      }

      if (params.attemptId) {
        await tx.query(
          `UPDATE payment_attempts
              SET status = 'SUCCEEDED',
                  provider_charge_id = $2,
                  simulated = COALESCE($3, simulated),
                  updated_at = now()
            WHERE id = $1`,
          [params.attemptId, params.providerChargeId, params.simulated ?? null],
        );
      } else {
        await tx.query(
          `UPDATE payment_attempts
              SET status = 'SUCCEEDED',
                  updated_at = now()
            WHERE provider_charge_id = $1`,
          [params.providerChargeId],
        );
      }

      await tx.query(
        `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload)
         VALUES ($1, $2, $3, 'APP', $4, $5::jsonb)`,
        [
          params.bookingId,
          params.complexId,
          completed ? 'CONFIRMED' : 'PAYMENT',
          params.payerUserId,
          JSON.stringify({
            hour: params.hour,
            date: params.date,
            court: params.courtName,
            payerName: params.payerName,
            method: params.method,
            providerChargeId: params.providerChargeId,
            paid: newPaid,
            total: locked.totalSlots,
          }),
        ],
      );

      return { ...spAfter, completed, duplicate: false, needsOverflowRefund: false };
    });

    // Si el cargo llegó cuando el split ya estaba lleno o expirado, ejecutamos reembolso compensatorio
    if (txOutcome.needsOverflowRefund) {
      const refund = await this.culqi.refundCharge({
        chargeId: params.providerChargeId,
        amountCents: params.amountCents,
        reason: 'duplicado',
        idempotencyKey: `refund_overflow_${params.providerChargeId}`,
      });
      const compensationStatus: 'REFUNDED' | 'COMPENSATION_FAILED' =
        refund.status === 'succeeded' ? 'REFUNDED' : 'COMPENSATION_FAILED';
      const overflowShareStatus = compensationStatus === 'REFUNDED' ? 'REFUNDED' : 'FAILED';
      const overflowRefundedAt = compensationStatus === 'REFUNDED' ? new Date().toISOString() : null;

      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO payment_shares (split_payment_id, attempt_id, payer_user_id, payer_name, method, provider,
                                       provider_charge_id, amount_cents, status, refund_id, refund_reason, refunded_at)
           VALUES ($1, $2, $3, $4, $5::payment_method, 'CULQI', $6, $7,
                   $8::share_status, $9, 'SPLIT_OVERFLOW_OR_EXPIRED', $10::timestamptz)
           ON CONFLICT (provider_charge_id) DO NOTHING`,
          [
            params.splitId,
            params.attemptId ?? null,
            params.payerUserId,
            params.payerName,
            params.method,
            params.providerChargeId,
            params.amountCents,
            overflowShareStatus,
            refund.id,
            overflowRefundedAt,
          ],
        );

        if (params.attemptId) {
          await tx.query(
            `UPDATE payment_attempts
                SET status = $2,
                    provider_charge_id = $3,
                    refund_id = $4,
                    refund_reason = 'SPLIT_OVERFLOW_OR_EXPIRED',
                    refunded_at = $5::timestamptz,
                    error_message = $6,
                    updated_at = now()
              WHERE id = $1`,
            [
              params.attemptId,
              compensationStatus,
              params.providerChargeId,
              refund.id,
              overflowRefundedAt,
              refund.userMessage,
            ],
          );
        } else {
          await tx.query(
            `INSERT INTO payment_attempts (idempotency_key, booking_id, split_payment_id, user_id, payer_name,
                                           purpose, method, provider, source_id, amount_cents, currency,
                                           provider_charge_id, status, simulated, refund_id, refund_reason, refunded_at, error_message)
             VALUES ($1, $2, $3, $4, $5, 'SPLIT_SLOT', $6::payment_method, 'CULQI', 'webhook_overflow', $7, 'PEN',
                     $8, $9, $10, $11, 'SPLIT_OVERFLOW_OR_EXPIRED', $12::timestamptz, $13)
             ON CONFLICT (provider_charge_id) DO UPDATE
               SET status = EXCLUDED.status,
                   refund_id = EXCLUDED.refund_id,
                   refund_reason = EXCLUDED.refund_reason,
                   refunded_at = EXCLUDED.refunded_at,
                   updated_at = now()`,
            [
              `wh_overflow_${params.providerChargeId}`,
              params.bookingId,
              params.splitId,
              params.payerUserId,
              params.payerName,
              params.method,
              params.amountCents,
              params.providerChargeId,
              compensationStatus,
              refund.simulated,
              refund.id,
              overflowRefundedAt,
              refund.userMessage,
            ],
          );
        }
      });

      return {
        id: txOutcome.id,
        shareToken: txOutcome.shareToken,
        paidSlots: txOutcome.paidSlots,
        totalSlots: txOutcome.totalSlots,
        status: txOutcome.status,
        completed: txOutcome.completed,
        duplicate: false,
        refunded: compensationStatus === 'REFUNDED',
        refundId: refund.id,
        compensationStatus,
      };
    }

    if (txOutcome.duplicate) {
      return txOutcome;
    }

    const newBookingStatus = txOutcome.completed ? 'CONFIRMED' : 'HELD';
    const slotPayload = {
      complexId: params.complexId,
      courtId: params.courtId,
      courtName: params.courtName,
      date: params.date,
      hour: params.hour,
      label: hourLabel(params.hour),
      status: newBookingStatus,
      channel: 'APP',
      bookingId: params.bookingId,
      priceCents: params.priceCents,
      split: {
        paid: txOutcome.paidSlots,
        total: txOutcome.totalSlots,
        mode: 'SPLIT',
        shareToken: txOutcome.shareToken,
      },
    };

    this.bus.publish([Rooms.complex(params.complexId), Rooms.split(txOutcome.shareToken)], 'split:updated', {
      shareToken: txOutcome.shareToken,
      bookingId: params.bookingId,
      paidSlots: txOutcome.paidSlots,
      totalSlots: txOutcome.totalSlots,
      status: txOutcome.status,
      bookingStatus: newBookingStatus,
      progressLabel: `Cupos pagados: ${txOutcome.paidSlots} de ${txOutcome.totalSlots}`,
      lastPayer: { name: params.payerName, method: params.method, amountCents: params.amountCents },
    });
    this.bus.publish(Rooms.complex(params.complexId), 'slot:updated', slotPayload);
    this.bus.publish(Rooms.complex(params.complexId), 'feed:event', {
      eventType: txOutcome.completed ? 'CONFIRMED' : 'PAYMENT',
      channel: 'APP',
      court: params.courtName,
      hour: params.hour,
      date: params.date,
      createdAt: new Date().toISOString(),
      summary: txOutcome.completed
        ? `Split completado (${txOutcome.paidSlots}/${txOutcome.totalSlots}) con ${params.method} por ${params.payerName} → Reserva CONFIRMADA`
        : `Pago ${params.method} de ${params.payerName}: Cupos pagados ${txOutcome.paidSlots} de ${txOutcome.totalSlots} (${params.courtName} · ${hourLabel(params.hour)})`,
    });

    return txOutcome;
  }

  /**
   * Valida y concilia un evento de webhook de Culqi comprobando:
   *  1. Firma HMAC-SHA256 sobre `rawBody` (`401 INVALID_WEBHOOK_SIGNATURE`).
   *  2. Estructura del evento y del objeto `charge` (`400 INVALID_WEBHOOK_PAYLOAD`).
   *  3. Moneda exacta (`PEN` -> `400 INVALID_WEBHOOK_CURRENCY`).
   *  4. Estado del cargo (`succeeded`, `pending`, `failed`).
   *  5. Referencia local (`payment_attempts` por `provider_charge_id` / `attemptId` o `split_payments` por `splitToken`).
   *  6. Monto exacto en céntimos contra el pago esperado (`400 WEBHOOK_AMOUNT_MISMATCH`).
   *  7. Idempotencia ante reintentos y soporte para transición `PENDING` -> `SUCCEEDED`.
   */
  async processCulqiWebhook(
    rawBody: string | Buffer | undefined,
    signature: string | undefined,
    body: any,
  ) {
    if (!signature || !rawBody || !this.culqi.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Firma HMAC-SHA256 de webhook ausente o inválida.',
      });
    }

    if (!body || typeof body !== 'object' || typeof body.type !== 'string' || body.data === undefined) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Payload de webhook malformado: faltan campos type o data.',
      });
    }

    let charge: any;
    try {
      charge = typeof body.data === 'string' ? JSON.parse(body.data) : body.data;
    } catch {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Payload de webhook malformado: data no es JSON válido.',
      });
    }

    if (!charge || typeof charge !== 'object' || typeof charge.id !== 'string' || !charge.id.trim()) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Payload de webhook inválido: falta charge.id.',
      });
    }
    if (charge.object && charge.object !== 'charge') {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_PAYLOAD',
        message: `Objeto de webhook inesperado: ${charge.object}.`,
      });
    }

    const currency = String(charge.currency_code ?? '').toUpperCase();
    if (currency !== 'PEN') {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_CURRENCY',
        message: `Moneda de cargo no coincide con PEN (recibido: ${charge.currency_code ?? 'vacío'}).`,
      });
    }

    const amountCents = Number(charge.amount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_AMOUNT',
        message: 'El monto del cargo en el webhook no es un entero positivo en céntimos.',
      });
    }

    const chargeId = charge.id.trim();
    const attemptIdMeta = charge?.metadata?.attemptId;
    const splitTokenMeta = charge?.metadata?.splitToken || charge?.metadata?.shareToken;

    // Buscar intento de pago registrado localmente
    const attempt = await this.db.one<{
      id: string;
      bookingId: string | null;
      splitPaymentId: string | null;
      userId: string | null;
      payerName: string;
      purpose: string;
      method: 'CARD' | 'YAPE' | 'PLIN';
      amountCents: number;
      currency: string;
      status: string;
    }>(
      `SELECT id, booking_id AS "bookingId", split_payment_id AS "splitPaymentId",
              user_id AS "userId", payer_name AS "payerName", purpose, method,
              amount_cents AS "amountCents", currency, status
         FROM payment_attempts
        WHERE provider_charge_id = $1
           OR ($2::text IS NOT NULL AND id::text = $2::text)
        LIMIT 1`,
      [chargeId, attemptIdMeta ?? null],
    );

    // Buscar split_payment asociado
    let sp = splitTokenMeta ? await this.getSplitByToken(splitTokenMeta).catch(() => null) : null;
    if (!sp && attempt?.splitPaymentId) {
      const spRow = await this.db.one<{ shareToken: string }>(
        `SELECT share_token AS "shareToken" FROM split_payments WHERE id = $1`,
        [attempt.splitPaymentId],
      );
      if (spRow?.shareToken) {
        sp = await this.getSplitByToken(spRow.shareToken).catch(() => null);
      }
    }

    if (!sp && !attempt) {
      throw new BadRequestException({
        code: 'UNKNOWN_PAYMENT_REFERENCE',
        message: 'El webhook no corresponde a ninguna referencia de pago ni splitToken registrado.',
      });
    }

    // Validar monto exacto contra el intento local o contra la cuota del split
    const expectedAmountCents = attempt ? attempt.amountCents : sp!.amountPerSlotCents;
    if (amountCents !== expectedAmountCents) {
      throw new BadRequestException({
        code: 'WEBHOOK_AMOUNT_MISMATCH',
        message: `El monto del cargo en el webhook (${amountCents}) no coincide con el monto esperado (${expectedAmountCents}).`,
      });
    }

    // Manejo de eventos pendientes
    if (body.type === 'charge.creation.pending' || body.type === 'charge.pending') {
      if (attempt && attempt.status === 'INITIATED') {
        await this.db.query(
          `UPDATE payment_attempts SET status = 'PENDING', provider_charge_id = $2, updated_at = now() WHERE id = $1`,
          [attempt.id, chargeId],
        );
      }
      return { received: true, status: 'PENDING', chargeId };
    }

    // Manejo de eventos fallidos
    if (body.type === 'charge.creation.failed' || body.type === 'charge.failed') {
      if (attempt && (attempt.status === 'INITIATED' || attempt.status === 'PENDING')) {
        await this.db.transaction(async (tx) => {
          await tx.query(
            `UPDATE payment_attempts
                SET status = 'FAILED',
                    provider_charge_id = $2,
                    error_code = 'WEBHOOK_CHARGE_FAILED',
                    updated_at = now()
              WHERE id = $1`,
            [attempt.id, chargeId],
          );
          if (attempt.splitPaymentId) {
            await tx.query(
              `UPDATE split_payments SET reserved_slots = GREATEST(0, reserved_slots - 1) WHERE id = $1`,
              [attempt.splitPaymentId],
            );
          }
          if (attempt.purpose === 'FULL_DEPOSIT' && attempt.bookingId) {
            await tx.query(
              `UPDATE bookings SET status = 'CANCELLED', hold_expires_at = NULL, updated_at = now()
                WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
              [attempt.bookingId],
            );
          }
        });
      }
      return { received: true, status: 'FAILED', chargeId };
    }

    if (body.type !== 'charge.creation.succeeded') {
      return { received: true, ignored: true };
    }

    // Validar que el outcome del cargo en charge.creation.succeeded no sea fallido/rechazado
    const outcomeType = String(charge?.outcome?.type ?? charge?.status ?? 'venta_exitosa').toLowerCase();
    if (['failed', 'error', 'denegada', 'rechazada'].includes(outcomeType)) {
      throw new BadRequestException({
        code: 'INVALID_WEBHOOK_CHARGE_STATUS',
        message: `El estado del cargo (${outcomeType}) no es acreditable como exitoso.`,
      });
    }

    const rawType = String(charge?.source?.type ?? charge?.metadata?.method ?? attempt?.method ?? 'yape').toUpperCase();
    const method: 'CARD' | 'YAPE' | 'PLIN' =
      rawType === 'CARD' ? 'CARD' : rawType === 'PLIN' ? 'PLIN' : 'YAPE';

    if (!sp) {
      throw new BadRequestException({
        code: 'UNKNOWN_PAYMENT_REFERENCE',
        message: 'No se encontró el registro split_payments asociado al cargo.',
      });
    }

    const reservedSlotHeld = attempt?.status === 'PENDING' || attempt?.status === 'INITIATED';
    const result = await this.recordVerifiedShare({
      splitId: sp.id,
      bookingId: sp.bookingId,
      complexId: sp.complexId,
      courtId: sp.courtId,
      courtName: sp.courtName,
      date: sp.date,
      hour: sp.hour,
      priceCents: sp.totalCents,
      payerUserId: attempt?.userId ?? null,
      payerName: charge.metadata?.payerName ?? attempt?.payerName ?? 'Jugador verificado',
      method,
      providerChargeId: chargeId,
      amountCents,
      attemptId: attempt?.id ?? null,
      reservedSlotHeld,
    });

    return {
      received: true,
      chargeId,
      action: result.refunded ? 'overflow_refunded' : result.duplicate ? 'duplicate_ignored' : 'credited',
      duplicate: result.duplicate,
      completed: result.completed,
      refunded: result.refunded ?? false,
      refundId: result.refundId ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Dashboard omnicanal y reportes del dueño de complejo
  // ---------------------------------------------------------------------------
  async ownerDashboard(complexId: string, date = limaToday(), user?: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException('Inicia sesión como propietario del complejo.');
    if (!isValidDate(date)) throw new BadRequestException('Fecha inválida');

    await this.expireStaleHolds();

    const complex = await this.db.one<{
      id: string;
      ownerId: string;
      name: string;
      ruc: string;
      businessName: string | null;
      licenseDocUrl: string | null;
      licenseDocUploadedAt: string | null;
      verificationStatus: string;
      verificationNotes: string | null;
      verifiedAt: string | null;
      districtCode: string;
      districtName: string;
      address: string;
      ownerName: string;
      ownerPhoneMasked: string;
    }>(
      `SELECT x.id, x.owner_id AS "ownerId", x.name, x.ruc, x.business_name AS "businessName",
              x.license_doc_url AS "licenseDocUrl", x.license_doc_uploaded_at AS "licenseDocUploadedAt",
              x.verification_status AS "verificationStatus", x.verification_notes AS "verificationNotes",
              x.verified_at AS "verifiedAt", x.district_code AS "districtCode", d.name AS "districtName",
              x.address, u.full_name AS "ownerName", u.phone_masked AS "ownerPhoneMasked"
         FROM complexes x
         JOIN districts d ON d.code = x.district_code
         JOIN users u ON u.id = x.owner_id
        WHERE x.id = $1`,
      [complexId],
    );
    if (!complex) throw new NotFoundException('Complejo no encontrado');
    if (complex.ownerId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('No eres el propietario registrado de este complejo deportivo.');
    }

    const [ownerComplexes, courts, events] = await Promise.all([
      this.db.query(
        `SELECT id, name, ruc, district_code AS "districtCode",
                verification_status AS "verificationStatus", license_doc_url AS "licenseDocUrl"
           FROM complexes WHERE owner_id = $1 ORDER BY created_at ASC`,
        [complex.ownerId],
      ),
      this.availability.courtsOfComplex(complexId),
      this.db.query(
        `SELECT id, booking_id AS "bookingId", event_type AS "eventType", channel,
                payload, created_at AS "createdAt"
           FROM booking_events
          WHERE complex_id = $1
          ORDER BY created_at DESC LIMIT 20`,
        [complexId],
      ),
    ]);

    const gridByCourt = await this.availability.gridForCourts(courts, date, true);

    let confirmedCount = 0;
    let receptionBlockedCount = 0;
    let activeSplitsCount = 0;
    let revenueCents = 0;
    let totalSlotsCount = 0;
    let occupiedSlotsCount = 0;

    for (const c of courts) {
      for (const s of gridByCourt[c.id] ?? []) {
        totalSlotsCount++;
        if (s.status === 'CONFIRMED') {
          confirmedCount++;
          occupiedSlotsCount++;
          revenueCents += s.priceCents;
        } else if (s.status === 'BLOCKED') {
          receptionBlockedCount++;
          occupiedSlotsCount++;
          revenueCents += s.priceCents;
        } else if (s.status === 'HELD') {
          activeSplitsCount++;
          occupiedSlotsCount++;
          if (s.split) {
            revenueCents += Math.round((s.priceCents * s.split.paid) / s.split.total);
          }
        }
      }
    }

    return {
      date,
      complex,
      ownerComplexes,
      courts: courts.map((c) => ({
        ...c,
        slots: gridByCourt[c.id] ?? [],
      })),
      kpis: {
        confirmedCount,
        receptionBlockedCount,
        activeSplitsCount,
        revenueCents,
        occupancyPercent: totalSlotsCount ? Math.round((occupiedSlotsCount / totalSlotsCount) * 100) : 0,
      },
      events,
    };
  }

  /**
   * Reporte consolidado de reservas e ingresos conciliados del complejo (Punto 12).
   * Suma pagos efectivamente conciliados en `payment_shares` (`status = 'PAID'`) y distingue:
   *  - `grossValueCents`        : valor bruto de las reservas activas (0 para canceladas/expiradas).
   *  - `reconciledPaidCents`    : total cobrado y conciliado (depósitos + cuotas split pagadas + ventas en recepción).
   *  - `depositCollectedCents`  : adelantos cobrados en reservas `FULL_DEPOSIT`.
   *  - `splitCollectedCents`    : cuotas cobradas en reservas `SPLIT` (completas o parciales).
   *  - `receptionCollectedCents`: cobros presenciales en recepción (`BLOCKED`).
   *  - `pendingBalanceCents`    : saldo pendiente por cobrar (ej. el 50 % restante en cancha de un `FULL_DEPOSIT`
   *                               o los cupos restantes de un `SPLIT` en estado `HELD`; 0 en canceladas/expiradas).
   */
  async ownerReport(complexId: string, user: AuthUser) {
    if (!user?.sub) throw new UnauthorizedException();
    await this.expireStaleHolds();

    const complex = await this.db.one<{ id: string; name: string; ownerId: string }>(
      `SELECT id, name, owner_id AS "ownerId" FROM complexes WHERE id = $1`,
      [complexId],
    );
    if (!complex) throw new NotFoundException('Complejo no encontrado');
    if (complex.ownerId !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('No eres el propietario de este complejo deportivo.');
    }

    const rows = await this.db.query<{
      bookingId: string;
      courtId: string;
      courtName: string;
      status: string;
      channel: string;
      paymentMode: string | null;
      startsAt: Date;
      totalCents: number;
      depositCents: number;
      customerName: string | null;
      organizerName: string | null;
      splitId: string | null;
      paidSlots: number | null;
      totalSlots: number | null;
      paidSharesCents: number;
      refundedSharesCents: number;
      createdAt: string;
    }>(
      `SELECT b.id AS "bookingId", b.court_id AS "courtId", c.name AS "courtName", b.status, b.channel,
              b.payment_mode AS "paymentMode", b.starts_at AS "startsAt",
              b.total_cents AS "totalCents", b.deposit_cents AS "depositCents",
              b.customer_name AS "customerName", u.full_name AS "organizerName",
              sp.id AS "splitId", sp.paid_slots AS "paidSlots", sp.total_slots AS "totalSlots",
              COALESCE((
                SELECT SUM(ps.amount_cents)::int
                  FROM payment_shares ps
                 WHERE ps.split_payment_id = sp.id AND ps.status = 'PAID'
              ), 0) AS "paidSharesCents",
              COALESCE((
                SELECT SUM(ps.amount_cents)::int
                  FROM payment_shares ps
                 WHERE ps.split_payment_id = sp.id AND ps.status = 'REFUNDED'
              ), 0) AS "refundedSharesCents",
              b.created_at AS "createdAt"
         FROM bookings b
         JOIN courts c ON c.id = b.court_id
         LEFT JOIN users u ON u.id = b.organizer_id
         LEFT JOIN split_payments sp ON sp.booking_id = b.id
        WHERE c.complex_id = $1
        ORDER BY b.starts_at DESC
        LIMIT 100`,
      [complexId],
    );

    const items = rows.map((r) => {
      const { date, hour } = toLimaSlot(r.startsAt);
      const isCancelledOrExpired = r.status === 'CANCELLED' || r.status === 'EXPIRED';
      const isActive = !isCancelledOrExpired;
      const grossValueCents = isActive ? r.totalCents : 0;

      let depositCollectedCents = 0;
      let splitCollectedCents = 0;
      let receptionCollectedCents = 0;

      if (isActive) {
        if (r.status === 'BLOCKED') {
          receptionCollectedCents = r.depositCents > 0 ? r.depositCents : r.totalCents;
        } else if (r.paymentMode === 'FULL_DEPOSIT') {
          // Si tiene payment_shares conciliados usa la suma real; si es fila semilla histórica sin split_payments usa deposit_cents
          depositCollectedCents =
            r.splitId !== null
              ? r.paidSharesCents
              : r.status === 'CONFIRMED'
                ? r.depositCents
                : 0;
        } else if (r.paymentMode === 'SPLIT') {
          splitCollectedCents = r.paidSharesCents;
        }
      }

      const reconciledPaidCents = isActive
        ? depositCollectedCents + splitCollectedCents + receptionCollectedCents
        : 0;
      const pendingBalanceCents = isActive ? Math.max(0, grossValueCents - reconciledPaidCents) : 0;

      return {
        id: r.bookingId,
        bookingId: r.bookingId,
        courtId: r.courtId,
        courtName: r.courtName,
        status: r.status,
        channel: r.channel,
        paymentMode: r.paymentMode,
        startsAt: r.startsAt,
        date,
        hour,
        hourLabel: hourLabel(hour),
        clientLabel: r.organizerName ?? r.customerName ?? 'Cliente en recepción',
        paidSlots: r.paidSlots,
        totalSlots: r.totalSlots,
        totalCents: r.totalCents,
        depositCents: r.depositCents,
        grossValueCents,
        reconciledPaidCents,
        depositCollectedCents,
        splitCollectedCents,
        receptionCollectedCents,
        pendingBalanceCents,
        refundedCents: r.refundedSharesCents,
        totalSoles: (r.totalCents / 100).toFixed(2),
        grossValueSoles: (grossValueCents / 100).toFixed(2),
        reconciledPaidSoles: (reconciledPaidCents / 100).toFixed(2),
        depositCollectedSoles: (depositCollectedCents / 100).toFixed(2),
        pendingBalanceSoles: (pendingBalanceCents / 100).toFixed(2),
        createdAt: r.createdAt,
      };
    });

    const activeItems = items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'EXPIRED');
    const confirmedItems = items.filter((i) => i.status === 'CONFIRMED' || i.status === 'BLOCKED');
    const cancelledOrExpiredItems = items.filter((i) => i.status === 'CANCELLED' || i.status === 'EXPIRED');

    const grossRevenueCents = activeItems.reduce((acc, i) => acc + i.grossValueCents, 0);
    const reconciledPaidCents = items.reduce((acc, i) => acc + i.reconciledPaidCents, 0);
    const depositCollectedCents = items.reduce((acc, i) => acc + i.depositCollectedCents, 0);
    const splitCollectedCents = items.reduce((acc, i) => acc + i.splitCollectedCents, 0);
    const receptionCollectedCents = items.reduce((acc, i) => acc + i.receptionCollectedCents, 0);
    const pendingBalanceCents = items.reduce((acc, i) => acc + i.pendingBalanceCents, 0);
    const refundedCents = items.reduce((acc, i) => acc + i.refundedCents, 0);

    return {
      complexId: complex.id,
      complexName: complex.name,
      generatedAt: new Date().toISOString(),
      summary: {
        totalBookings: items.length,
        activeBookings: activeItems.length,
        confirmedBookings: confirmedItems.length,
        cancelledOrExpiredBookings: cancelledOrExpiredItems.length,
        grossRevenueCents,
        grossRevenueSoles: Number((grossRevenueCents / 100).toFixed(2)),
        reconciledPaidCents,
        reconciledPaidSoles: Number((reconciledPaidCents / 100).toFixed(2)),
        depositCollectedCents,
        depositCollectedSoles: Number((depositCollectedCents / 100).toFixed(2)),
        splitCollectedCents,
        splitCollectedSoles: Number((splitCollectedCents / 100).toFixed(2)),
        receptionCollectedCents,
        receptionCollectedSoles: Number((receptionCollectedCents / 100).toFixed(2)),
        pendingBalanceCents,
        pendingBalanceSoles: Number((pendingBalanceCents / 100).toFixed(2)),
        refundedCents,
        refundedSoles: Number((refundedCents / 100).toFixed(2)),
        // Alias retrocompatible que ahora refleja el monto efectivamente conciliado
        confirmedRevenueCents: reconciledPaidCents,
        confirmedRevenueSoles: Number((reconciledPaidCents / 100).toFixed(2)),
      },
      items,
      bookings: items,
    };
  }

  private buildWhatsappShareUrl(
    token: string,
    complexName: string,
    courtName: string,
    date: string,
    hour: number,
    amountPerSlotCents: number,
  ): string {
    const soles = (amountPerSlotCents / 100).toFixed(2);
    const link = `${this.cfg.publicUrl}/mobile/?split=${token}`;
    const text = `⚽ *Pichanga en ${complexName}* (${courtName})\n📅 ${date} · 🕗 ${hourLabel(hour)}\n💸 Cuota por jugador: *S/ ${soles}* (Yape / Plin / Tarjeta)\n👉 Paga tu cupo aquí: ${link}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }
}
