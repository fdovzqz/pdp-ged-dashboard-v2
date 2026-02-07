/**
 * Parsers para logs CloudWatch (V1, V2, PaymentProcess).
 * Usado por la action fetchAndIngest.
 */

import {
  timestampToMexicoDate,
  timestampToMexicoMonth,
} from "./mexicoDate";

export type LogSource = "v1" | "v2" | "payment";

export interface ParsedRecord {
  referencia: string;
  monto: number;
  timestamp: string;
  fechaTransaccion: string;
  logSource: LogSource;
  movimiento: string;
  estatus: string;
  tramiteId?: number;
  importMonth: string;
  importDate: string;
}

type RawRow = Record<string, string>;

/** Normaliza estatus PA, PAGADO, PAGO VALIDADO -> "PAGO VALIDADO" */
function normalizeEstatus(estatus: string): string {
  const s = String(estatus ?? "").trim().toUpperCase();
  if (s === "PA" || s === "PAGADO" || s === "PAGO VALIDADO") {
    return "PAGO VALIDADO";
  }
  return s || "PAGO VALIDADO";
}

/** Fecha/mes en hora México (UTC-6). Timestamps CloudWatch son UTC. */
function extractImportMonth(ts: string, fechaTxn: string): string {
  const date = extractImportDate(ts, fechaTxn);
  return date ? date.substring(0, 7) : "2026-01";
}

/** Fecha YYYY-MM-DD en hora México (UTC-6). Timestamps CloudWatch y fechaTxn son UTC. */
function extractImportDate(ts: string, fechaTxn: string): string {
  if (ts && /^\d{4}/.test(ts)) {
    const d = timestampToMexicoDate(ts);
    if (d) return d;
  }
  if (fechaTxn && /^\d{4}/.test(fechaTxn)) {
    const d = timestampToMexicoDate(fechaTxn);
    if (d) return d;
  }
  return "";
}

export function parseV1V2(
  rows: RawRow[],
  source: "v1" | "v2"
): ParsedRecord[] {
  const results: ParsedRecord[] = [];
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
        const fechaTxn = String(input?.fechaTransaccion ?? "");

        results.push({
          referencia,
          monto,
          timestamp,
          fechaTransaccion: fechaTxn,
          logSource: source,
          movimiento: String(input?.movimiento ?? "").trim(),
          estatus: normalizeEstatus(String(input?.estatus ?? "")),
          tramiteId: input?.tramiteId != null ? Number(input.tramiteId) : undefined,
          importMonth: extractImportMonth(timestamp, fechaTxn),
          importDate: extractImportDate(timestamp, fechaTxn),
        });
      }
    } catch {
      continue;
    }
  }
  return results;
}

function extractFromJson(jsonStr: string): {
  referencia?: string;
  monto?: number;
  fechaTransaccion?: string;
  tramiteId?: number;
  movimiento?: string;
} {
  const result: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    result.referencia = String(parsed.referencia ?? parsed.reference ?? "").trim() || undefined;
    const amt = parsed.importeTxn ?? parsed.monto ?? parsed.total_pagar;
    result.monto = typeof amt === "number" ? amt : typeof amt === "string" ? parseFloat(amt) : undefined;
    result.fechaTransaccion = String(parsed.fechaTransaccion ?? parsed.fecha ?? "").trim() || undefined;
    result.tramiteId = parsed.tramiteId != null ? Number(parsed.tramiteId) : undefined;
    result.movimiento = String(parsed.movimiento ?? parsed.tipo ?? parsed.type ?? "").trim() || undefined;
  } catch {
    const refMatch = jsonStr.match(/"referencia"\s*:\s*"([^"]+)"/);
    if (refMatch) result.referencia = refMatch[1];
    const montoMatch = jsonStr.match(/"total_pagar"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"total_pagar"\s*:\s*(\d+)/);
    if (montoMatch) result.monto = parseFloat(montoMatch[1] ?? montoMatch[2] ?? "0");
    const tramiteMatch = jsonStr.match(/"tramiteId"\s*:\s*(\d+)/);
    if (tramiteMatch) result.tramiteId = parseInt(tramiteMatch[1], 10);
    const movMatch =
      jsonStr.match(/"movimiento"\s*:\s*"([^"]+)"/) ??
      jsonStr.match(/"tipo"\s*:\s*"([^"]+)"/);
    if (movMatch) result.movimiento = movMatch[1];
  }
  return result as {
    referencia?: string;
    monto?: number;
    fechaTransaccion?: string;
    tramiteId?: number;
    movimiento?: string;
  };
}

export function parsePayment(rows: RawRow[]): ParsedRecord[] {
  const results: ParsedRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    try {
      const timestamp = row["@timestamp"] ?? "";
      const refParsed = row["referencia"]?.trim();
      const montoStr = row["monto"];
      const tramiteIdStr = row["tramiteId"] ?? row["tramite"];

      if (refParsed && !seen.has(refParsed)) {
        seen.add(refParsed);
        let monto = montoStr
          ? parseFloat(String(montoStr).replace(/[^0-9.-]/g, ""))
          : 0;
        if (Number.isNaN(monto) || monto === 0) {
          try {
            const msg = JSON.parse(row["@message"] ?? "{}") as Record<string, unknown>;
            const paramsStr = (msg?.details as Record<string, unknown>)
              ?.parameters as string | undefined;
            if (typeof paramsStr === "string") {
              const ext = extractFromJson(paramsStr);
              const match = paramsStr.match(
                /"total_pagar"\s*:\s*"([^"]+)"|"total_pagar"\s*:\s*(\d+)/
              );
              monto = ext.monto ?? (match ? parseFloat(match[1] ?? match[2] ?? "0") : 0);
            }
          } catch {
            /* ignore */
          }
        }
        const movimiento = (row["movimiento"] ?? row["tipo"] ?? "").trim();
        results.push({
          referencia: refParsed,
          monto: Number.isNaN(monto) ? 0 : monto,
          timestamp,
          fechaTransaccion: timestamp,
          logSource: "payment",
          movimiento,
          estatus: "PAGO VALIDADO",
          tramiteId: tramiteIdStr ? parseInt(String(tramiteIdStr), 10) : undefined,
          importMonth: extractImportMonth(timestamp, timestamp),
          importDate: extractImportDate(timestamp, timestamp),
        });
        continue;
      }

      const messageStr = row["@message"];
      if (!messageStr) continue;

      const message = JSON.parse(messageStr) as Record<string, unknown>;
      const details = message?.details as Record<string, unknown> | undefined;
      const paramsStr = details?.parameters;
      if (typeof paramsStr !== "string" || !paramsStr.includes("PAGO VALIDADO"))
        continue;

      const ext = extractFromJson(paramsStr);
      const referencia = ext.referencia ?? "";
      if (!referencia || seen.has(referencia)) continue;

      const totalPagarMatch = paramsStr.match(
        /"total_pagar"\s*:\s*"([^"]+)"|"total_pagar"\s*:\s*(\d+)/
      );
      const monto =
        ext.monto ??
        (totalPagarMatch
          ? parseFloat(totalPagarMatch[1] ?? totalPagarMatch[2] ?? "0")
          : 0);
      const fechaTxn = ext.fechaTransaccion ?? timestamp;
      const movimiento = ext.movimiento ?? "";

      seen.add(referencia);
      results.push({
        referencia,
        monto,
        timestamp,
        fechaTransaccion: fechaTxn,
        logSource: "payment",
        movimiento,
        estatus: "PAGO VALIDADO",
        tramiteId: ext.tramiteId,
        importMonth: extractImportMonth(timestamp, fechaTxn),
        importDate: extractImportDate(timestamp, fechaTxn),
      });
    } catch {
      continue;
    }
  }
  return results;
}
