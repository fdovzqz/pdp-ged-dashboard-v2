/**
 * Utilidad para rangos de fecha en hora de México (UTC-6).
 * CloudWatch almacena timestamps en UTC; convertimos día local México → rango UTC.
 *
 * México UTC-6:
 * - 00:00 México = 06:00 UTC del mismo día
 * - 23:59:59.999 México = 05:59:59.999 UTC del día siguiente
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

export function getMexicoDateRangeUtc(dateStr: string): {
  startTimeSec: number;
  endTimeSec: number;
} {
  const [y, mo, day] = dateStr.split("-").map(Number);
  const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
  return {
    startTimeSec: Math.floor(startUtc.getTime() / 1000),
    endTimeSec: Math.floor(endUtc.getTime() / 1000),
  };
}

export function getMexicoDateRangeUtcMultiDay(
  startDateStr: string,
  endDateStr: string
): {
  startTimeSec: number;
  endTimeSec: number;
} {
  const [y1, mo1, d1] = startDateStr.split("-").map(Number);
  const [y2, mo2, d2] = endDateStr.split("-").map(Number);
  const startUtc = new Date(Date.UTC(y1, mo1 - 1, d1, 6, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y2, mo2 - 1, d2 + 1, 5, 59, 59, 999));
  return {
    startTimeSec: Math.floor(startUtc.getTime() / 1000),
    endTimeSec: Math.floor(endUtc.getTime() / 1000),
  };
}
