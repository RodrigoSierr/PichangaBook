import { ConflictException } from '@nestjs/common';

/** SQLSTATE devuelto por la restricción EXCLUDE `bookings_no_overlap`. */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_UNIQUE_VIOLATION = '23505';

export function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === code;
}

/** Traduce el choque de horarios del motor a un HTTP 409 entendible para el usuario. */
export function rethrowSlotConflict(err: unknown): never {
  if (isPgError(err, PG_EXCLUSION_VIOLATION)) {
    throw new ConflictException({
      code: 'SLOT_TAKEN',
      message: 'Este turno acaba de ser tomado por otro usuario o en recepción.',
    });
  }
  throw err;
}
