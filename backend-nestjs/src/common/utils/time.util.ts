/**
 * Utilidades de fecha para Arequipa (America/Lima = UTC-5 fijo, sin horario de verano).
 * Los turnos se manejan como (fecha local YYYY-MM-DD, hora entera 0-23).
 */
export const LIMA_OFFSET_HOURS = 5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(date);
}

/** Fecha de hoy en Lima, formato YYYY-MM-DD. */
export function limaToday(offsetDays = 0): string {
  const now = new Date(Date.now() - LIMA_OFFSET_HOURS * 3600_000 + offsetDays * 86400_000);
  return now.toISOString().slice(0, 10);
}

/** Instante UTC del inicio del turno `hour` (hora local de Lima) en `date`. */
export function limaSlotStart(date: string, hour: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + LIMA_OFFSET_HOURS, 0, 0));
}

/** Convierte un instante UTC a { date, hour } en hora de Lima. */
export function toLimaSlot(instant: Date | string): { date: string; hour: number } {
  const t = new Date(new Date(instant).getTime() - LIMA_OFFSET_HOURS * 3600_000);
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
