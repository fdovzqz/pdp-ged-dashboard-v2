/**
 * Utilidad para fecha en hora de México (UTC-6).
 * Todas las fechas de negocio (fechaTransaccion, tableros, agregados) se interpretan
 * de forma consistente en zona México: 00:00 México = 06:00 UTC.
 * CloudWatch timestamps son UTC; convertimos a día local México.
 */

const MEXICO_UTC_OFFSET_HOURS = 6;

/** CloudWatch/ISO timestamp (UTC) → YYYY-MM-DD en hora México. */
export function timestampToMexicoDate(timestamp: string): string {
  if (!timestamp || !/^\d{4}/.test(timestamp)) return "";
  const normalized = timestamp.includes("T") || timestamp.endsWith("Z")
    ? timestamp
    : timestamp.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  const mexicoMs = date.getTime() - MEXICO_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const m = new Date(mexicoMs);
  const y = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, "0");
  const d = String(m.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/**
 * Fecha de transacción → YYYY-MM-DD en hora México (UTC-6).
 * Usado para datamapping y tablas agregadas. Consistente en todo el sistema.
 * - Si es solo fecha (YYYY-MM-DD): se asume ya en México, se devuelve tal cual.
 * - Si tiene Z u offset: se interpreta como UTC y se convierte a México.
 */
export function fechaTransaccionToMexicoDate(fechaTransaccion: string): string {
  if (!fechaTransaccion || !/^\d{4}/.test(fechaTransaccion)) return "";
  const trimmed = fechaTransaccion.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return timestampToMexicoDate(trimmed);
}

/** Timestamp UTC → YYYY-MM en hora México. */
export function timestampToMexicoMonth(timestamp: string): string {
  const dateStr = timestampToMexicoDate(timestamp);
  return dateStr ? dateStr.substring(0, 7) : "";
}

/** CloudWatch/ISO timestamp (UTC) → hora (0-23) en zona México. */
export function timestampToMexicoHour(timestamp: string): number {
  if (!timestamp || !/^\d{4}/.test(timestamp)) return 0;
  const normalized = timestamp.includes("T") || timestamp.endsWith("Z")
    ? timestamp
    : timestamp.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return 0;
  const mexicoMs = date.getTime() - MEXICO_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const m = new Date(mexicoMs);
  return m.getUTCHours();
}

export interface MexicoDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

/** Timestamp UTC → { year, month, day, hour } en zona México. */
export function timestampToMexicoParts(timestamp: string): MexicoDateParts | null {
  if (!timestamp || !/^\d{4}/.test(timestamp)) return null;
  const normalized = timestamp.includes("T") || timestamp.endsWith("Z")
    ? timestamp
    : timestamp.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  const mexicoMs = date.getTime() - MEXICO_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const m = new Date(mexicoMs);
  return {
    year: m.getUTCFullYear(),
    month: m.getUTCMonth() + 1,
    day: m.getUTCDate(),
    hour: m.getUTCHours(),
  };
}

/**
 * Parsea fecha de transacción (o updatedAt) a partes en hora México (UTC-6).
 * Usado por ETL de agregados DataMapping: tableros mensual y anual usan siempre
 * fechaTransaccion interpretada en zona México.
 * - Si tiene Z o offset → UTC, se convierte a México.
 * - Si NO tiene zona (YYYY-MM-DD o "YYYY-MM-DDTHH:mm") → se asume ya en México.
 */
export function datamappingUpdatedAtToParts(
  updatedAt: string
): MexicoDateParts | null {
  if (!updatedAt || !/^\d{4}/.test(updatedAt)) return null;
  const hasTimezone =
    updatedAt.endsWith("Z") ||
    /[+-]\d{2}:?\d{2}$/.test(updatedAt) ||
    updatedAt.includes("+00:00");
  if (hasTimezone) {
    return timestampToMexicoParts(updatedAt);
  }
  const m = updatedAt.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/
  );
  if (m) {
    return {
      year: parseInt(m[1], 10),
      month: parseInt(m[2], 10),
      day: parseInt(m[3], 10),
      hour: parseInt(m[4], 10),
    };
  }
  const mDateOnly = updatedAt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mDateOnly) {
    return {
      year: parseInt(mDateOnly[1], 10),
      month: parseInt(mDateOnly[2], 10),
      day: parseInt(mDateOnly[3], 10),
      hour: 0,
    };
  }
  return null;
}

/** Determina si una fecha es fin de semana (sábado o domingo). */
export function isWeekend(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  const dow = d.getDay(); // 0 = Sunday, 6 = Saturday
  return dow === 0 || dow === 6;
}

const DAY_NAMES_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

/** Obtiene el nombre del día de la semana. */
export function getDayOfWeek(year: number, month: number, day: number): string {
  const d = new Date(year, month - 1, day);
  const dow = d.getDay();
  return DAY_NAMES_ES[dow] ?? "Desconocido";
}
