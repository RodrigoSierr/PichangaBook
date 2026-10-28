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
  split?: { paid: number; total: number; mode: string };
  // Sólo visibles para el dueño del complejo
  customerName?: string | null;
  organizerName?: string | null;
  notes?: string | null;
}

export interface CourtRow {
  id: string;
  complexId: string;
  name: string;
  playersPerSide: number;
  priceCents: number;
  pricePeakCents: number;
  openHour: number;
  closeHour: number;
}

export const PEAK_FROM_HOUR = 18;
export const ACTIVE_STATUSES = `('HELD','PENDING_PAYMENT','CONFIRMED','BLOCKED')`;
export const COURT_COLUMNS = `c.id, c.complex_id AS "complexId", c.name, c.players_per_side AS "playersPerSide",
  c.price_cents AS "priceCents", c.price_peak_cents AS "pricePeakCents",
  c.open_hour AS "openHour", c.close_hour AS "closeHour"`;

/** Literal de arreglo PostgreSQL compatible con pg y PGlite. */
export const pgArray = (values: string[]) => `{${values.join(',')}}`;

export function priceFor(court: Pick<CourtRow, 'priceCents' | 'pricePeakCents'>, hour: number): number {
  return hour >= PEAK_FROM_HOUR ? court.pricePeakCents : court.priceCents;
}

/**
 * Construye la parrilla horaria (turnos de 1 h) a partir de las reservas vigentes.
 * Es la "fuente de verdad" que consumen la app móvil y el panel del dueño.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly db: DatabaseService) {}

  async getCourt(courtId: string, exec: SqlExecutor = this.db): Promise<CourtRow & { complexName: string; ownerId: string; verificationStatus: string }> {
    const [court] = await exec.query<CourtRow & { complexName: string; ownerId: string; verificationStatus: string }>(
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
      id: string; courtId: string; status: SlotStatus; channel: string; startsAt: Date;
      customerName: string | null; organizerName: string | null; notes: string | null;
      paidSlots: number | null; totalSlots: number | null; mode: string | null;
    }>(
      `SELECT b.id, b.court_id AS "courtId", b.status, b.channel, b.starts_at AS "startsAt",
              b.customer_name AS "customerName", b.notes, u.full_name AS "organizerName",
              sp.paid_slots AS "paidSlots", sp.total_slots AS "totalSlots", sp.mode::text AS mode
         FROM bookings b
         LEFT JOIN users u ON u.id = b.organizer_id
         LEFT JOIN split_payments sp ON sp.booking_id = b.id
        WHERE b.court_id = ANY($1::uuid[])
          AND b.starts_at >= $2 AND b.starts_at < $3
          AND b.status IN ${ACTIVE_STATUSES}`,
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
          if (b.totalSlots && b.mode === 'SPLIT') slot.split = { paid: b.paidSlots ?? 0, total: b.totalSlots, mode: b.mode };
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
