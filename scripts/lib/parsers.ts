/**
 * Parsers for V1, V2, and PaymentProcess CloudWatch logs.
 * Normalizes to Convex paymentRecords schema.
 */

import { timestampToMexicoDate, timestampToMexicoMonth } from "./mexicoDateRange";

export type LogSource = "v1" | "v2" | "payment";

export interface NormalizedPaymentRecord {
  referencia: string;
  monto: number;
  timestamp: string;
  fechaTransaccion: string;
  logSource: LogSource;
  movimiento: string;
  estatus: string;
  tramiteId?: number;
  rawData?: string;
  importMonth: string;
}

type RawLogRow = Record<string, string>;

/** YYYY-MM en hora México (UTC-6). Timestamps CloudWatch son UTC. */
function extractImportMonth(timestamp: string, fechaTransaccion: string): string {
  if (timestamp && /^\d{4}/.test(timestamp)) {
    const m = timestampToMexicoMonth(timestamp);
    if (m) return m;
  }
  if (fechaTransaccion && /^\d{4}/.test(fechaTransaccion)) {
    const m = timestampToMexicoMonth(fechaTransaccion);
    if (m) return m;
  }
  return "2026-01";
}

/** Parse V1/V2 reconciliation logs (Preparar Datos, details.input or parameters.Payload) */
export function parseV1V2Logs(
  rows: RawLogRow[],
  source: "v1" | "v2"
): NormalizedPaymentRecord[] {
  const results: NormalizedPaymentRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    try {
      const timestamp = row["@timestamp"] ?? "";
      const messageStr = row["@message"];
      if (!messageStr) continue;

      const message = JSON.parse(messageStr) as Record<string, unknown>;
      const details = message?.details as Record<string, unknown> | undefined;
      if (!details) continue;

      let items: Record<string, unknown>[] = [];

      const inputStr = details.input;
      if (typeof inputStr === "string" && inputStr !== "null") {
        const input = JSON.parse(inputStr) as Record<string, unknown>;
        const transacciones = input?.transacciones;
        if (Array.isArray(transacciones)) {
          items = transacciones as Record<string, unknown>[];
        } else if (input?.referencia) {
          items = [input];
        }
      }

      if (items.length === 0 && typeof details.parameters === "string") {
        const params = JSON.parse(details.parameters) as {
          Payload?: Record<string, unknown>;
        };
        const payload = params?.Payload;
        if (payload?.referencia) items = [payload];
      }

      for (const input of items) {
        const referencia = String(input?.referencia ?? "").trim();
        if (!referencia || seen.has(referencia)) continue;
        seen.add(referencia);

        const importeTxn = input?.importeTxn;
        const monto =
          typeof importeTxn === "string"
            ? parseFloat(importeTxn)
            : Number(importeTxn ?? 0);

        const rec: NormalizedPaymentRecord = {
          referencia,
          monto,
          timestamp,
          fechaTransaccion: String(input?.fechaTransaccion ?? ""),
          logSource: source,
          movimiento: String(input?.movimiento ?? "").trim(),
          estatus: String(input?.estatus ?? ""),
          tramiteId: input?.tramiteId != null ? Number(input.tramiteId) : undefined,
          rawData: JSON.stringify(input),
          importMonth: extractImportMonth(timestamp, String(input?.fechaTransaccion ?? "")),
        };
        results.push(rec);
      }
    } catch {
      continue;
    }
  }
  return results;
}

/** Extract fields from JSON string using regex fallbacks (for PaymentProcess with unknown structure) */
function extractFromJson(jsonStr: string): {
  referencia?: string;
  monto?: number;
  fechaTransaccion?: string;
  movimiento?: string;
  estatus?: string;
} {
  const result: ReturnType<typeof extractFromJson> = {};
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    result.referencia = String(parsed.referencia ?? parsed.reference ?? "").trim() || undefined;
    const amt = parsed.importeTxn ?? parsed.monto ?? parsed.amount ?? parsed.importe;
    result.monto = typeof amt === "number" ? amt : typeof amt === "string" ? parseFloat(amt) : undefined;
    result.fechaTransaccion = String(parsed.fechaTransaccion ?? parsed.fecha ?? parsed.date ?? "").trim() || undefined;
    result.movimiento = String(parsed.movimiento ?? parsed.tipo ?? parsed.type ?? "").trim() || undefined;
    result.estatus = String(parsed.estatus ?? parsed.status ?? parsed.estado ?? "").trim() || undefined;
  } catch {
    // Regex fallbacks
    const refMatch = jsonStr.match(/"referencia"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"reference"\s*:\s*"([^"]+)"/);
    if (refMatch) result.referencia = refMatch[1];
    const montoMatch = jsonStr.match(/"importeTxn"\s*:\s*(\d+)/) ?? jsonStr.match(/"monto"\s*:\s*(\d+)/) ?? jsonStr.match(/"amount"\s*:\s*(\d+)/);
    if (montoMatch) result.monto = parseFloat(montoMatch[1]);
    const fechaMatch = jsonStr.match(/"fechaTransaccion"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"fecha"\s*:\s*"([^"]+)"/);
    if (fechaMatch) result.fechaTransaccion = fechaMatch[1];
    const movMatch = jsonStr.match(/"movimiento"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"tipo"\s*:\s*"([^"]+)"/);
    if (movMatch) result.movimiento = movMatch[1];
    const statusMatch = jsonStr.match(/"estatus"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"status"\s*:\s*"([^"]+)"/);
    if (statusMatch) result.estatus = statusMatch[1];
  }
  return result;
}

/** Parse PaymentProcess logs (flexible structure - credit card processor) */
export function parsePaymentLogs(rows: RawLogRow[]): NormalizedPaymentRecord[] {
  const results: NormalizedPaymentRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    try {
      const timestamp = row["@timestamp"] ?? "";
      const messageStr = row["@message"];
      if (!messageStr) continue;

      const message = JSON.parse(messageStr) as Record<string, unknown>;
      const details = message?.details as Record<string, unknown> | undefined;
      if (!details) continue;

      const sources: string[] = [];
      if (typeof details.input === "string" && details.input !== "null")
        sources.push(details.input);
      if (typeof details.output === "string" && details.output !== "null")
        sources.push(details.output);
      if (typeof details.parameters === "string")
        sources.push(details.parameters);

      let best: { referencia: string; ext: ReturnType<typeof extractFromJson>; src: string } | null = null;
      for (const src of sources) {
        const ext = extractFromJson(src);
        const referencia = ext.referencia ?? "";
        if (!referencia || seen.has(referencia)) continue;
        if (!best || (ext.monto ?? 0) > (best.ext.monto ?? 0)) {
          best = { referencia, ext, src };
        }
      }
      if (best) {
        seen.add(best.referencia);
        const m = best.ext.monto ?? 0;
        const ft = best.ext.fechaTransaccion ?? timestamp;
        results.push({
          referencia: best.referencia,
          monto: m,
          timestamp,
          fechaTransaccion: ft,
          logSource: "payment",
          movimiento: best.ext.movimiento ?? "",
          estatus: best.ext.estatus ?? "",
          rawData:
            best.src.length > 2000
              ? best.src.substring(0, 2000) + "..."
              : best.src,
          importMonth: extractImportMonth(timestamp, ft),
        });
      }
    } catch {
      continue;
    }
  }
  return results;
}
