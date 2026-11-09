import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, SqlExecutor } from '../database/database.service';
import { hourLabel, limaSlotStart } from '../common/utils/time.util';

export type SlotStatus = 'FREE' | 'PAST' | 'HELD' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'BLOCKED';

export interface Slot {
  hour: number;
  label: string;
  startsAt: string;
  status: SlotStatus;
  isPast: boolean;
  priceCents: number;
  bookingId?: string;
  channel?: string;
  holdExpiresAt?: string | null;
  split?: { paid: number; total: number; mode: string; shareToken?: string | null };
  // Sólo visibles para el dueño del complejo
  customerName?: string | null;
  organizerName?: string | null;
  notes?: string | null;
}

export interface CourtRow {
  id: string;
  complexId: string;
  name: string;
  surface: string;
  playersPerSide: number;
  priceCents: number;
  pricePeakCents: number;
  openHour: number;
  closeHour: number;
}

export const PEAK_FROM_HOUR = 18;
export const ACTIVE_STATUSES = `('HELD','PENDING_PAYMENT','CONFIRMED','BLOCKED')`;
export const COURT_COLUMNS = `c.id, c.complex_id AS "complexId", c.name, c.surface,
  c.players_per_side AS "playersPerSide",
  c.price_cents AS "priceCents", c.price_peak_cents AS "pricePeakCents",
  c.open_hour AS "openHour", c.close_hour AS "closeHour"`;

/** Literal de arreglo PostgreSQL compatible con pg y PGlite. */
export const pgArray = (values: string[]) => `{${values.join(',')}}`;

export function priceFor(court: Pick<CourtRow, 'priceCents' | 'pricePeakCents'>, hour: number): number {
  return hour >= PEAK_FROM_HOUR ? court.pricePeakCents : court.priceCents;
}

/**
 * Construye la parrilla horaria (turnos de 1 h) a partir de las reservas vigentes.
 * Excluye automáticamente las reservas temporales (HELD / PENDING_PAYMENT) cuyo
 * `hold_expires_at` ya haya vencido.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly db: DatabaseService) {}

  async getCourt(
    courtId: string,
    exec: SqlExecutor = this.db,
  ): Promise<CourtRow & { complexName: string; ownerId: string; verificationStatus: string }> {
    const [court] = await exec.query<
      CourtRow & { complexName: string; ownerId: string; verificationStatus: string }
    >(
      `SELECT ${COURT_COLUMNS}, x.name AS "complexName", x.owner_id AS "ownerId",
              x.verification_status AS "verificationStatus"
         FROM courts c JOIN complexes x ON x.id = c.complex_id
        WHERE c.id = $1 AND c.is_active`,
      [courtId],
    );
    if (!court) throw new NotFoundException('Cancha no encontrada');
    return court;
  }

  async courtsOfComplex(complexId: string): Promise<CourtRow[]> {
    return this.db.query<CourtRow>(
      `SELECT ${COURT_COLUMNS} FROM courts c WHERE c.complex_id = $1 AND c.is_active ORDER BY c.name`,
      [complexId],
    );
  }

  async gridForCourts(courts: CourtRow[], date: string, ownerView = false): Promise<Record<string, Slot[]>> {
    if (!courts.length) return {};
    const dayStart = limaSlotStart(date, 0).toISOString();
    const dayEnd = limaSlotStart(date, 24).toISOString();
    const bookings = await this.db.query<{
      id: string;
      courtId: string;
      status: SlotStatus;
      channel: string;
      startsAt: Date;
      holdExpiresAt: string | null;
      customerName: string | null;
      organizerName: string | null;
      notes: string | null;
      paidSlots: number | null;
      totalSlots: number | null;
      mode: string | null;
      shareToken: string | null;
    }>(
      `SELECT b.id, b.court_id AS "courtId", b.status, b.channel, b.starts_at AS "startsAt",
              b.hold_expires_at AS "holdExpiresAt",
              b.customer_name AS "customerName", b.notes, u.full_name AS "organizerName",
              sp.paid_slots AS "paidSlots", sp.total_slots AS "totalSlots",
              sp.mode::text AS mode, sp.share_token AS "shareToken"
         FROM bookings b
         LEFT JOIN users u ON u.id = b.organizer_id
         LEFT JOIN split_payments sp ON sp.booking_id = b.id
        WHERE b.court_id = ANY($1::uuid[])
          AND b.starts_at >= $2 AND b.starts_at < $3
          AND b.status IN ${ACTIVE_STATUSES}
          AND (
            b.status NOT IN ('HELD', 'PENDING_PAYMENT')
            OR b.hold_expires_at IS NULL
            OR b.hold_expires_at > now()
          )`,
      [pgArray(courts.map((c) => c.id)), dayStart, dayEnd],
    );

    const now = Date.now();
    const result: Record<string, Slot[]> = {};
    for (const court of courts) {
      const slots: Slot[] = [];
      for (let h = court.openHour; h < court.closeHour; h++) {
        const start = limaSlotStart(date, h);
        const isPast = start.getTime() + 3600_000 <= now;
        const b = bookings.find((x) => x.courtId === court.id && new Date(x.startsAt).getTime() === start.getTime());
        const slot: Slot = {
          hour: h,
          label: hourLabel(h),
          startsAt: start.toISOString(),
          status: b ? b.status : isPast ? 'PAST' : 'FREE',
          isPast,
          priceCents: priceFor(court, h),
        };
        if (b) {
          slot.bookingId = b.id;
          slot.channel = b.channel;
          slot.holdExpiresAt = b.holdExpiresAt;
          if (b.totalSlots && b.mode === 'SPLIT') {
            slot.split = {
              paid: b.paidSlots ?? 0,
              total: b.totalSlots,
              mode: b.mode,
              shareToken: b.shareToken,
            };
          }
          if (ownerView) {
            slot.customerName = b.customerName;
            slot.organizerName = b.organizerName;
            slot.notes = b.notes;
          }
        }
        slots.push(slot);
      }
      result[court.id] = slots;
    }
    return result;
  }

  async courtGrid(courtId: string, date: string) {
    const court = await this.getCourt(courtId);
    const grid = await this.gridForCourts([court], date);
    return { court, date, slots: grid[court.id] };
  }
}
