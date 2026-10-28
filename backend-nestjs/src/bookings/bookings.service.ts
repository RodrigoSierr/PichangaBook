import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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
export class BookingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly culqi: CulqiService,
    private readonly bus: RealtimeBus,
    private readonly cfg: AppConfig,
  ) {}

  /**
   * Reserva un turno desde la app móvil (FULL_DEPOSIT o SPLIT).
   * Corre dentro de una transacción ACID con constraint EXCLUDE GiST.
   */
  async createBooking(dto: CreateBookingDto, user?: AuthUser) {
    if (!isValidDate(dto.date)) throw new BadRequestException('Fecha inválida');
    const organizerId = user?.sub ?? DEMO_ORGANIZER_ID;
    const court = await this.availability.getCourt(dto.courtId);

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
    const status = isSplit ? 'HELD' : 'CONFIRMED';
    const method = dto.method ?? 'YAPE';

    try {
      const result = await this.db.transaction(async (tx) => {
        const [booking] = await tx.query<{
          id: string;
          status: string;
          channel: string;
          startsAt: string;
          endsAt: string;
          totalCents: number;
          depositCents: number;
        }>(
          `INSERT INTO bookings (court_id, organizer_id, created_by, channel, status, payment_mode,
                                 starts_at, ends_at, total_cents, deposit_cents, notes, hold_expires_at)
           VALUES ($1, $2, $2, 'APP', $3::booking_status, $4::payment_mode, $5, $6, $7, $8, $9,
                   CASE WHEN $3 = 'HELD' THEN now() + INTERVAL '30 minutes' ELSE NULL END)
           RETURNING id, status, channel, starts_at AS "startsAt", ends_at AS "endsAt",
                     total_cents AS "totalCents", deposit_cents AS "depositCents"`,
          [
            court.id,
            organizerId,
            status,
            dto.paymentMode,
            startsAt.toISOString(),
            endsAt.toISOString(),
            totalCents,
            depositCents,
            dto.notes ?? null,
          ],
        );

        let splitInfo: any = null;
        if (isSplit) {
          const shareToken = `pk${randomBytes(5).toString('hex')}`;
          const [sp] = await tx.query<{
            id: string;
            shareToken: string;
            totalSlots: number;
            paidSlots: number;
            amountPerSlotCents: number;
          }>(
            `INSERT INTO split_payments (booking_id, organizer_id, mode, total_slots, paid_slots,
                                         amount_per_slot_cents, total_cents, share_token, status, expires_at)
             VALUES ($1, $2, 'SPLIT', $3, 1, $4, $5, $6, 'OPEN', now() + INTERVAL '30 minutes')
             RETURNING id, share_token AS "shareToken", total_slots AS "totalSlots",
                       paid_slots AS "paidSlots", amount_per_slot_cents AS "amountPerSlotCents"`,
            [booking.id, organizerId, totalSlots, amountPerSlotCents, totalCents, shareToken],
          );

          const charge = await this.culqi.createCharge({
            amountCents: amountPerSlotCents,
            email: 'organizador@pichangabook.pe',
            method,
            description: `Cupo 1/${totalSlots} · ${court.name}`,
            metadata: { bookingId: booking.id, splitToken: shareToken },
          });

          await tx.query(
            `INSERT INTO payment_shares (split_payment_id, payer_user_id, payer_name, method, provider, provider_charge_id, amount_cents)
             VALUES ($1, $2, $3, $4::payment_method, 'CULQI', $5, $6)`,
            [sp.id, organizerId, dto.payerName ?? 'Organizador (tú)', method, charge.id, amountPerSlotCents],
          );

          splitInfo = sp;
        }

        await tx.query(
          `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload)
           VALUES ($1, $2, $3, 'APP', $4, $5::jsonb)`,
          [
            booking.id,
            court.complexId,
            isSplit ? 'CREATED' : 'CONFIRMED',
            organizerId,
            JSON.stringify({
              hour: dto.hour,
              date: dto.date,
              courtId: court.id,
              court: court.name,
              mode: dto.paymentMode,
              paid: isSplit ? 1 : totalSlots,
              total: totalSlots,
            }),
          ],
        );

        return { booking, splitInfo };
      });

      const slotPayload = {
        complexId: court.complexId,
        courtId: court.id,
        courtName: court.name,
        date: dto.date,
        hour: dto.hour,
        label: hourLabel(dto.hour),
        status: result.booking.status,
        channel: 'APP',
        bookingId: result.booking.id,
        priceCents: totalCents,
        split: result.splitInfo
          ? {
              paid: result.splitInfo.paidSlots,
              total: result.splitInfo.totalSlots,
              mode: 'SPLIT',
              shareToken: result.splitInfo.shareToken,
            }
          : undefined,
      };

      this.bus.publish(Rooms.complex(court.complexId), 'slot:updated', slotPayload);
      this.bus.publish(Rooms.complex(court.complexId), 'feed:event', {
        eventType: isSplit ? 'CREATED' : 'CONFIRMED',
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
        ...result.booking,
        court: { id: court.id, name: court.name, complexId: court.complexId, complexName: court.complexName },
        date: dto.date,
        hour: dto.hour,
        split: result.splitInfo
          ? {
              ...result.splitInfo,
              whatsappUrl: this.buildWhatsappShareUrl(
                result.splitInfo.shareToken,
                court.complexName,
                court.name,
                dto.date,
                dto.hour,
                result.splitInfo.amountPerSlotCents,
              ),
            }
          : null,
      };
    } catch (err) {
      rethrowSlotConflict(err);
    }
  }

  /**
   * Bloqueo rápido desde el Panel Web de Recepción (ventas presenciales o telefónicas).
   * Evita el doble booking de inmediato en la BD y notifica por WebSockets a todas las apps abiertas.
   */
  async receptionBlock(dto: ReceptionBlockDto, user?: AuthUser) {
    if (!isValidDate(dto.date)) throw new BadRequestException('Fecha inválida');
    const actorId = user?.sub ?? DEMO_OWNER_ID;
    const court = await this.availability.getCourt(dto.courtId);

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
          [court.id, actorId, channel, startsAt.toISOString(), endsAt.toISOString(), totalCents, customerName, dto.notes ?? null],
        );

        await tx.query(
          `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload)
           VALUES ($1, $2, 'BLOCKED', $3::booking_channel, $4, $5::jsonb)`,
          [
            b.id,
            court.complexId,
            channel,
            actorId,
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

  /** Libera un turno bloqueado o cancela una reserva antes de su inicio. */
  async releaseBooking(bookingId: string, user?: AuthUser) {
    const actorId = user?.sub ?? DEMO_OWNER_ID;
    const existing = await this.db.one<{
      id: string;
      courtId: string;
      courtName: string;
      complexId: string;
      startsAt: Date;
      priceCents: number;
    }>(
      `SELECT b.id, b.court_id AS "courtId", c.name AS "courtName", c.complex_id AS "complexId",
              b.starts_at AS "startsAt", b.total_cents AS "priceCents"
         FROM bookings b JOIN courts c ON c.id = b.court_id
        WHERE b.id = $1`,
      [bookingId],
    );
    if (!existing) throw new NotFoundException('Reserva/bloqueo no encontrado');

    const { date, hour } = toLimaSlot(existing.startsAt);

    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE bookings SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [bookingId]);
      await tx.query(
        `INSERT INTO booking_events (booking_id, complex_id, event_type, channel, actor_id, payload)
         VALUES ($1, $2, 'RELEASED', 'RECEPTION', $3, $4::jsonb)`,
        [
          bookingId,
          existing.complexId,
          actorId,
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
      channel: 'RECEPTION',
      court: existing.courtName,
      hour,
      date,
      createdAt: new Date().toISOString(),
      summary: `Turno liberado en ${existing.courtName} · ${hourLabel(hour)}`,
    });

    return slotPayload;
  }

  // ---------------------------------------------------------------------------
  // Split Payment (link de cobro fraccionado para WhatsApp + contador en vivo)
  // ---------------------------------------------------------------------------
  async getSplitByToken(token: string) {
    const sp = await this.db.one<{
      id: string;
      bookingId: string;
      shareToken: string;
      mode: string;
      totalSlots: number;
      paidSlots: number;
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
              amount_cents AS "amountCents", status, paid_at AS "paidAt"
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
   * Procesa el pago de 1 cupo en el Split Payment (vía Yape, Plin o Tarjeta).
   * Dispara cargo en Culqi, valida webhook firmado e incrementa `paid_slots` de forma atómica.
   */
  async paySplitSlot(token: string, dto: PaySplitSlotDto, user?: AuthUser) {
    const current = await this.getSplitByToken(token);
    if (current.status === 'COMPLETED' || current.paidSlots >= current.totalSlots) {
      throw new ConflictException('Todos los cupos de esta pichanga ya están pagados.');
    }

    const charge = await this.culqi.createCharge({
      amountCents: current.amountPerSlotCents,
      email: 'jugador@pichangabook.pe',
      method: dto.method,
      sourceId: dto.sourceId,
      description: `Cupo pichanga · ${current.courtName} (${current.hourLabel})`,
      metadata: {
        splitToken: token,
        bookingId: current.bookingId,
        payerName: dto.payerName.trim(),
      },
    });

    if (charge.status !== 'succeeded') {
      throw new BadRequestException('El pago fue rechazado por la pasarela.');
    }

    // Construimos y verificamos la firma HMAC-SHA256 exactamente como en el webhook de Culqi
    const webhook = this.culqi.buildWebhookEvent(charge);
    if (!this.culqi.verifySignature(webhook.raw, webhook.signature)) {
      throw new BadRequestException('Firma de webhook inválida');
    }

    await this.recordVerifiedShare({
      splitId: current.id,
      bookingId: current.bookingId,
      complexId: current.complexId,
      courtId: current.courtId,
      courtName: current.courtName,
      date: current.date,
      hour: current.hour,
      priceCents: current.totalCents,
      payerUserId: user?.sub ?? null,
      payerName: dto.payerName.trim(),
      method: dto.method,
      providerChargeId: charge.id,
      amountCents: current.amountPerSlotCents,
    });

    return this.getSplitByToken(token);
  }

  /**
   * Registra un abono verificado de pasarela de forma idempotente (por `provider_charge_id`)
   * y si se completan los cupos (`paid_slots = total_slots`) pasa la reserva a CONFIRMED.
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
  }) {
    const updated = await this.db.transaction(async (tx) => {
      const [locked] = await tx.query<{
        id: string;
        shareToken: string;
        paidSlots: number;
        totalSlots: number;
        status: string;
      }>(
        `SELECT id, share_token AS "shareToken", paid_slots AS "paidSlots",
                total_slots AS "totalSlots", status
           FROM split_payments WHERE id = $1 FOR UPDATE`,
        [params.splitId],
      );
      if (!locked) throw new NotFoundException();
      if (locked.paidSlots >= locked.totalSlots) return locked;

      await tx.query(
        `INSERT INTO payment_shares (split_payment_id, payer_user_id, payer_name, method, provider, provider_charge_id, amount_cents)
         VALUES ($1, $2, $3, $4::payment_method, 'CULQI', $5, $6)
         ON CONFLICT (provider_charge_id) DO NOTHING`,
        [
          params.splitId,
          params.payerUserId,
          params.payerName,
          params.method,
          params.providerChargeId,
          params.amountCents,
        ],
      );

      const newPaid = locked.paidSlots + 1;
      const completed = newPaid >= locked.totalSlots;

      const [spAfter] = await tx.query<{
        id: string;
        shareToken: string;
        paidSlots: number;
        totalSlots: number;
        status: string;
      }>(
        `UPDATE split_payments
            SET paid_slots = $2,
                status = CASE WHEN $3 THEN 'COMPLETED'::split_status ELSE status END,
                completed_at = CASE WHEN $3 THEN now() ELSE completed_at END
          WHERE id = $1
          RETURNING id, share_token AS "shareToken", paid_slots AS "paidSlots",
                    total_slots AS "totalSlots", status`,
        [params.splitId, newPaid, completed],
      );

      if (completed) {
        await tx.query(
          `UPDATE bookings SET status = 'CONFIRMED', hold_expires_at = NULL, updated_at = now() WHERE id = $1`,
          [params.bookingId],
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
            paid: newPaid,
            total: locked.totalSlots,
          }),
        ],
      );

      return { ...spAfter, completed };
    });

    const newBookingStatus = (updated as any).completed ? 'CONFIRMED' : 'HELD';
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
        paid: updated.paidSlots,
        total: updated.totalSlots,
        mode: 'SPLIT',
        shareToken: updated.shareToken,
      },
    };

    this.bus.publish([Rooms.complex(params.complexId), Rooms.split(updated.shareToken)], 'split:updated', {
      shareToken: updated.shareToken,
      bookingId: params.bookingId,
      paidSlots: updated.paidSlots,
      totalSlots: updated.totalSlots,
      status: updated.status,
      bookingStatus: newBookingStatus,
      progressLabel: `Cupos pagados: ${updated.paidSlots} de ${updated.totalSlots}`,
      lastPayer: { name: params.payerName, method: params.method, amountCents: params.amountCents },
    });
    this.bus.publish(Rooms.complex(params.complexId), 'slot:updated', slotPayload);
    this.bus.publish(Rooms.complex(params.complexId), 'feed:event', {
      eventType: (updated as any).completed ? 'CONFIRMED' : 'PAYMENT',
      channel: 'APP',
      court: params.courtName,
      hour: params.hour,
      date: params.date,
      createdAt: new Date().toISOString(),
      summary: (updated as any).completed
        ? `Split completado (${updated.paidSlots}/${updated.totalSlots}) con ${params.method} por ${params.payerName} → Reserva CONFIRMADA`
        : `Pago ${params.method} de ${params.payerName}: Cupos pagados ${updated.paidSlots} de ${updated.totalSlots} (${params.courtName} · ${hourLabel(params.hour)})`,
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard omnicanal del dueño de complejo
  // ---------------------------------------------------------------------------
  async ownerDashboard(complexId: string, date = limaToday()) {
    if (!isValidDate(date)) throw new BadRequestException('Fecha inválida');
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
