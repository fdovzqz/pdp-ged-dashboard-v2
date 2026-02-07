/**
 * Utilidad para fecha en hora de México (UTC-6).
 * CloudWatch timestamps son UTC; convertimos a día local México.
 */

/** CloudWatch/ISO timestamp (UTC) → YYYY-MM-DD en hora México. */
export function timestampToMexicoDate(timestamp: string): string {
  if (!timestamp || !/^\d{4}/.test(timestamp)) return "";
  const normalized = timestamp.includes("T") || timestamp.endsWith("Z")
    ? timestamp
    : timestamp.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  const mexicoMs = date.getTime() - 6 * 60 * 60 * 1000;
  const m = new Date(mexicoMs);
  const y = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, "0");
  const d = String(m.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
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
  const mexicoMs = date.getTime() - 6 * 60 * 60 * 1000;
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
  const mexicoMs = date.getTime() - 6 * 60 * 60 * 1000;
  const m = new Date(mexicoMs);
  return {
    year: m.getUTCFullYear(),
    month: m.getUTCMonth() + 1,
    day: m.getUTCDate(),
    hour: m.getUTCHours(),
  };
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
