/**
 * Parsers for V1, V2, and PaymentProcess CloudWatch logs.
 */

export type LogSource = "v1" | "v2" | "payment";

export interface ParsedPaymentRecord {
  referencia: string;
  monto: number;
  timestamp: string;
  fechaTransaccion: string;
  logSource: LogSource;
  movimiento: string;
  estatus: string;
  tramiteId?: number;
}

type RawLogRow = Record<string, string>;

/** Parse V1/V2 reconciliation logs (Preparar Datos) */
export function parseV1V2Logs(
  rows: RawLogRow[],
  source: "v1" | "v2"
): ParsedPaymentRecord[] {
  const results: ParsedPaymentRecord[] = [];
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

        results.push({
          referencia,
          monto,
          timestamp,
          fechaTransaccion: String(input?.fechaTransaccion ?? ""),
          logSource: source,
          movimiento: String(input?.movimiento ?? "").trim(),
          estatus: String(input?.estatus ?? ""),
          tramiteId: input?.tramiteId != null ? Number(input.tramiteId) : undefined,
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
  movimiento?: string;
  estatus?: string;
  tramiteId?: number;
} {
  const result: ReturnType<typeof extractFromJson> = {};
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    result.referencia = String(parsed.referencia ?? parsed.reference ?? "").trim() || undefined;
    const amt = parsed.importeTxn ?? parsed.monto ?? parsed.amount ?? parsed.importe ?? parsed.total_pagar;
    result.monto = typeof amt === "number" ? amt : typeof amt === "string" ? parseFloat(amt) : undefined;
    result.fechaTransaccion = String(parsed.fechaTransaccion ?? parsed.fecha ?? parsed.date ?? "").trim() || undefined;
    result.movimiento = String(parsed.movimiento ?? parsed.tipo ?? parsed.type ?? "").trim() || undefined;
    result.estatus = String(parsed.estatus ?? parsed.status ?? parsed.estado ?? "").trim() || undefined;
    result.tramiteId = parsed.tramiteId != null ? Number(parsed.tramiteId) : undefined;
  } catch {
    const refMatch = jsonStr.match(/"referencia"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"reference"\s*:\s*"([^"]+)"/);
    if (refMatch) result.referencia = refMatch[1];
    const montoMatch = jsonStr.match(/"importeTxn"\s*:\s*(\d+)/) ?? jsonStr.match(/"total_pagar"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"total_pagar"\s*:\s*(\d+)/) ?? jsonStr.match(/"monto"\s*:\s*(\d+)/) ?? jsonStr.match(/"amount"\s*:\s*(\d+)/);
    if (montoMatch) result.monto = parseFloat(montoMatch[1]);
    const fechaMatch = jsonStr.match(/"fechaTransaccion"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"fecha"\s*:\s*"([^"]+)"/);
    if (fechaMatch) result.fechaTransaccion = fechaMatch[1];
    const movMatch = jsonStr.match(/"movimiento"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"tipo"\s*:\s*"([^"]+)"/);
    if (movMatch) result.movimiento = movMatch[1];
    const statusMatch = jsonStr.match(/"estatus"\s*:\s*"([^"]+)"/) ?? jsonStr.match(/"status"\s*:\s*"([^"]+)"/);
    if (statusMatch) result.estatus = statusMatch[1];
    const tramiteMatch = jsonStr.match(/"tramiteId"\s*:\s*(\d+)/);
    if (tramiteMatch) result.tramiteId = parseInt(tramiteMatch[1], 10);
  }
  return result;
}

/**
 * Parse PaymentProcess logs (EVO/TC - credit card processor).
 * Soporta: 1) CloudWatch parsed output (referencia, monto, tramiteId como columnas)
 *          2) Fallback: extraer de details.parameters (status PAGO VALIDADO)
 */
export function parsePaymentLogs(rows: RawLogRow[]): ParsedPaymentRecord[] {
  const results: ParsedPaymentRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    try {
      const timestamp = row["@timestamp"] ?? "";
      // Si CloudWatch ya parseó (query con parse directive)
      const refParsed = row["referencia"]?.trim();
      const montoStr = row["monto"];
      const tramiteIdStr = row["tramiteId"] ?? row["tramite"];
      const movimiento = (row["movimiento"] ?? row["tipo"] ?? "").trim();

      if (refParsed && !seen.has(refParsed)) {
        seen.add(refParsed);
        let monto = montoStr ? parseFloat(String(montoStr).replace(/[^0-9.-]/g, "")) : 0;
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
        results.push({
          referencia: refParsed,
          monto: Number.isNaN(monto) ? 0 : monto,
          timestamp,
          fechaTransaccion: timestamp,
          logSource: "payment",
          movimiento,
          estatus: "PAGO VALIDADO",
          tramiteId: tramiteIdStr ? parseInt(String(tramiteIdStr), 10) : undefined,
        });
        continue;
      }

      // Fallback: extraer de details.parameters
      const messageStr = row["@message"];
      if (!messageStr) continue;

      const message = JSON.parse(messageStr) as Record<string, unknown>;
      const details = message?.details as Record<string, unknown> | undefined;
      const paramsStr = details?.parameters;
      if (typeof paramsStr !== "string" || paramsStr === "null") continue;
      if (!paramsStr.includes("PAGO VALIDADO")) continue;

      const ext = extractFromJson(paramsStr);
      const referencia = ext.referencia ?? "";
      if (!referencia || seen.has(referencia)) continue;

      // Buscar total_pagar si extractFromJson no lo capturó
      const totalPagarMatch = paramsStr.match(/"total_pagar"\s*:\s*"([^"]+)"|"total_pagar"\s*:\s*(\d+)/);
      const monto = ext.monto ?? (totalPagarMatch ? parseFloat(totalPagarMatch[1] ?? totalPagarMatch[2] ?? "0") : 0);

      seen.add(referencia);
      results.push({
        referencia,
        monto,
        timestamp,
        fechaTransaccion: ext.fechaTransaccion ?? timestamp,
        logSource: "payment",
        movimiento: ext.movimiento ?? "",
        estatus: "PAGO VALIDADO",
        tramiteId: ext.tramiteId,
      });
    } catch {
      continue;
    }
  }
  return results;
}
