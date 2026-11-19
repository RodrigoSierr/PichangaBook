import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';

/** SQLSTATE devuelto por la restricción EXCLUDE `bookings_no_overlap`. */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_INVALID_TEXT_REPRESENTATION = '22P02';

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

/** Mapea errores nativos de PostgreSQL (SQLSTATE) a excepciones HTTP estándar. */
export function mapPgErrorToHttpException(err: unknown): HttpException | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: string }).code;
  if (!code) return null;

  switch (code) {
    case PG_EXCLUSION_VIOLATION:
      return new ConflictException({
        code: 'SLOT_TAKEN',
        message: 'Este turno acaba de ser tomado por otro usuario o en recepción.',
      });
    case PG_UNIQUE_VIOLATION:
      return new ConflictException({
        code: 'DUPLICATE_RESOURCE',
        message: 'El registro ya existe o entra en conflicto con un identificador único.',
      });
    case PG_FOREIGN_KEY_VIOLATION:
      return new BadRequestException({
        code: 'FOREIGN_KEY_VIOLATION',
        message: 'Referencia inválida: el recurso relacionado no existe.',
      });
    case PG_CHECK_VIOLATION:
      return new BadRequestException({
        code: 'CONSTRAINT_VIOLATION',
        message: 'Los datos enviados incumplen una restricción de integridad.',
      });
    case PG_INVALID_TEXT_REPRESENTATION:
      return new BadRequestException({
        code: 'INVALID_IDENTIFIER_FORMAT',
        message: 'Formato de identificador o tipo de dato inválido.',
      });
    default:
      return null;
  }
}
