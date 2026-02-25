"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import { parseV1V2, parsePayment } from "./lib/parsers";
import { normalizeWithConfig } from "./movementCodes";

/** Límite Convex: 600 segundos por acción. */
const ACTION_TIME_LIMIT_MS = 550_000;

const LOG_GROUPS = {
  v1: process.env.CLOUDWATCH_LOG_GROUP_V1!,
  v2: process.env.CLOUDWATCH_LOG_GROUP_V2!,
  payment: process.env.CLOUDWATCH_LOG_GROUP_PAYMENT!,
} as const;

const client = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/** Pausa entre ventanas (dentro de una misma fuente). */
const CLOUDWATCH_DELAY_MS = 1200;
/** Pausa entre fuentes: al terminar todas las ventanas de una fuente, esperar antes de iniciar la siguiente para que el rate limit de AWS se recupere. */
const CLOUDWATCH_PAUSE_BETWEEN_SOURCES_MS = 20_000;

/** Referencias sentinela (5 SPEI) para logs de diagnóstico en fetchAndIngestForDate. */
const SENTINEL_REFERENCIAS = [
  "202600002323148754268",
  "202600002968248834274",
  "202600002823548839291",
  "202600002547848836231",
  "202600002531048837213",
];

function sentinelIn(refs: string[]): string[] {
  return SENTINEL_REFERENCIAS.filter((s) => refs.includes(s));
}
function sentinelMissing(refs: string[]): string[] {
  return SENTINEL_REFERENCIAS.filter((s) => !refs.includes(s));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Detecta ThrottlingException / Rate exceeded incluso si el SDK envuelve el error. */
function isThrottlingError(e: unknown): boolean {
  for (let err: unknown = e; err && typeof err === "object"; err = (err as { cause?: unknown }).cause) {
    const o = err as { name?: string; __type?: string; message?: string };
    const msg = o.message ?? "";
    if (
      o.name === "ThrottlingException" ||
      o.__type === "ThrottlingException" ||
      msg.includes("Rate exceeded") ||
      msg.includes("ThrottlingException")
    ) {
      return true;
    }
  }
  const msg = e && typeof e === "object" ? (e as { message?: string }).message ?? "" : "";
  return typeof msg === "string" && (msg.includes("Rate exceeded") || msg.includes("ThrottlingException"));
}

/**
 * Límite de tiempo total en reintentos por llamada, para no acercarnos al límite de 600s de Convex.
 * Con 3 fuentes (v1, v2, payment) y hasta ~90s de retry cada una, quedan ~330s para el resto de la acción.
 */
const CLOUDWATCH_MAX_TOTAL_RETRY_MS = 90_000;

/** Ejecuta fn y reintenta con backoff exponencial si AWS devuelve ThrottlingException. */
async function withRetryOnThrottle<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number; maxTotalRetryMs?: number } = {}
): Promise<T> {
  const {
    maxRetries = 10,
    baseDelayMs = 5000,
    maxTotalRetryMs = CLOUDWATCH_MAX_TOTAL_RETRY_MS,
  } = opts;
  let last: unknown;
  let totalRetryMs = 0;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < maxRetries && isThrottlingError(e) && totalRetryMs < maxTotalRetryMs) {
        const baseDelay = baseDelayMs * Math.pow(2, i);
        const jitter = Math.random() * 0.3 * baseDelay;
        const delayMs = Math.min(
          baseDelay + jitter,
          30_000,
          maxTotalRetryMs - totalRetryMs
        );
        totalRetryMs += delayMs;
        console.warn(
          `[CloudWatch] ThrottlingException/Rate exceeded, reintento en ${Math.round(delayMs)}ms (${i + 1}/${maxRetries}, ${Math.round(totalRetryMs / 1000)}s de retry acumulado)`
        );
        await sleep(delayMs);
      } else {
        throw e;
      }
    }
  }
  throw last;
}

async function fetchCloudWatch(
  version: "v1" | "v2" | "payment",
  startTimeSec: number,
  endTimeSec: number
): Promise<Array<Record<string, string>>> {
  const logGroup = LOG_GROUPS[version];
  if (!logGroup?.trim()) {
    throw new Error(
      `CLOUDWATCH_LOG_GROUP_${version.toUpperCase()} no está configurado en Convex. Añade la variable en Dashboard → Settings → Environment Variables.`
    );
  }
  const query =
    version === "payment"
      ? `fields @timestamp, @message, @logStream, @log
| filter details.parameters like /./
| parse details.parameters '"status":"*"' as status
| parse details.parameters '"tramite":"*"' as tramite
| parse details.parameters '"referencia":"*"' as referencia
| parse details.parameters '"total_pagar":"*"' as monto
| parse details.parameters '"movimiento":"*"' as movimiento
| parse details.parameters '"tipo":"*"' as tipo
| filter status like /PAGO VALIDADO/
| sort @timestamp desc
| limit 10000`
      : version === "v2"
        ? `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| sort @timestamp desc
| limit 10000`
        : `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit 10000`;

  // Mismo formato que el proceso original (fetchAndIngestForDate): segundos epoch.
  const startRes = await withRetryOnThrottle(() =>
    client.send(
      new StartQueryCommand({
        logGroupName: logGroup,
        startTime: startTimeSec,
        endTime: endTimeSec,
        queryString: query,
      })
    )
  );
  if (!startRes.queryId) throw new Error("No queryId");

  let status: QueryStatus | undefined = QueryStatus.Running;
  let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
  let attempts = 0;

  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= 90) throw new Error("Query timeout (90s)");
    await sleep(1000);
    const getRes = await withRetryOnThrottle(() =>
      client.send(new GetQueryResultsCommand({ queryId: startRes.queryId }))
    );
    status = getRes.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      rawResults = getRes.results || [];
      break;
    }
  }

  return rawResults.map((row) => {
    const result: Record<string, string> = {};
    for (const f of row) {
      if (f.field && f.value) result[f.field] = f.value;
    }
    return result;
  });
}

/** Límite de eventos por query de extracción (CloudWatch Logs Insights). */
const MAX_EVENTS_PER_QUERY = 10_000;

/** Resultado de un bucket de conteo por hora. */
export type HourBucket = { startSec: number; endSec: number; count: number };

/** Query de solo conteo por hora (sin listar eventos). Mismos filtros que la extracción. */
function getCountByHourQuery(version: "v1" | "v2" | "payment"): string {
  if (version === "payment") {
    return `filter details.parameters like /./
| parse details.parameters '"status":"*"' as status
| filter status like /PAGO VALIDADO/
| stats count() by bin(1h)`;
  }
  if (version === "v2") {
    return `filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| stats count() by bin(1h)`;
  }
  return `filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| stats count() by bin(1h)`;
}

/**
 * Ejecuta conteo por hora para una fuente en un rango [startTimeSec, endTimeSec].
 * Devuelve lista de buckets con startSec, endSec y count. Bucket count=0 o fuera de retención es esperado (v1/v2 empezaron después).
 */
export async function countByHour(
  version: "v1" | "v2" | "payment",
  startTimeSec: number,
  endTimeSec: number
): Promise<HourBucket[]> {
  const logGroup = LOG_GROUPS[version];
  if (!logGroup?.trim()) {
    throw new Error(`CLOUDWATCH_LOG_GROUP_${version.toUpperCase()} no está configurado.`);
  }
  const queryString = getCountByHourQuery(version);
  const startRes = await withRetryOnThrottle(() =>
    client.send(
      new StartQueryCommand({
        logGroupName: logGroup,
        startTime: startTimeSec,
        endTime: endTimeSec,
        queryString,
      })
    )
  );
  if (!startRes.queryId) throw new Error("No queryId");

  let status: QueryStatus | undefined = QueryStatus.Running;
  let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
  let attempts = 0;
  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= 90) throw new Error("Query timeout (90s)");
    await sleep(1000);
    const getRes = await withRetryOnThrottle(() =>
      client.send(new GetQueryResultsCommand({ queryId: startRes.queryId }))
    );
    status = getRes.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      rawResults = getRes.results || [];
      break;
    }
  }

  const buckets: HourBucket[] = [];
  const oneHourSec = 3600;
  for (const row of rawResults) {
    const map: Record<string, string> = {};
    for (const f of row) {
      if (f.field && f.value) map[f.field] = f.value;
    }
    const count = parseInt(
      map["count"] ?? map["count()"] ?? map["count(*)"] ?? "0",
      10
    );
    const binVal = map["bin(1h)"] ?? map["bin(@timestamp, 1h)"];
    let startSec = startTimeSec;
    if (binVal) {
      const asNum = parseInt(binVal, 10);
      if (Number.isFinite(asNum) && String(asNum).length === binVal.trim().length) {
        startSec = asNum <= 1e12 ? asNum : Math.floor(asNum / 1000);
      } else {
        const ms = new Date(binVal).getTime();
        if (Number.isFinite(ms)) startSec = Math.floor(ms / 1000);
      }
    }
    const endSec = Math.min(startSec + oneHourSec, endTimeSec);
    if (endSec > startSec) {
      buckets.push({ startSec, endSec, count });
    }
  }
  if (buckets.length === 0 && startTimeSec < endTimeSec) {
    buckets.push({ startSec: startTimeSec, endSec: endTimeSec, count: 0 });
  }
  return buckets.sort((a, b) => a.startSec - b.startSec);
}

/** Intervalo de extracción: [startSec, endSec] con tope de eventos. */
export type ExtractionInterval = { startSec: number; endSec: number; expectedCount: number };

/**
 * Dado buckets por hora, construye intervalos de extracción de modo que ninguno supere maxEventsPerQuery.
 * Si un bucket tiene count > tope, se subdivide en mitades (30m, 15m, etc.) hasta quedar bajo tope.
 */
export function buildExtractionIntervals(
  hourBuckets: HourBucket[],
  maxEventsPerQuery: number = MAX_EVENTS_PER_QUERY
): ExtractionInterval[] {
  const out: ExtractionInterval[] = [];
  for (const b of hourBuckets) {
    if (b.count <= 0) {
      out.push({ startSec: b.startSec, endSec: b.endSec, expectedCount: 0 });
      continue;
    }
    if (b.count <= maxEventsPerQuery) {
      out.push({ startSec: b.startSec, endSec: b.endSec, expectedCount: b.count });
      continue;
    }
    const spanSec = b.endSec - b.startSec;
    const n = Math.ceil(b.count / maxEventsPerQuery);
    const stepSec = spanSec / n;
    const countPerPart = Math.ceil(b.count / n);
    for (let i = 0; i < n; i++) {
      const startSec = b.startSec + i * stepSec;
      const endSec = i === n - 1 ? b.endSec : b.startSec + (i + 1) * stepSec;
      out.push({ startSec, endSec, expectedCount: countPerPart });
    }
  }
  return out;
}

/**
 * Fetch CloudWatch para un rango en 4 ventanas (6h cada una) para soportar hasta ~40k eventos/día.
 * CloudWatch Logs Insights tiene un máximo de 10k eventos por query; con 4 ventanas obtenemos hasta 40k.
 */
async function fetchCloudWatchWithWindows(
  version: "v1" | "v2" | "payment",
  startTimeSec: number,
  endTimeSec: number
): Promise<Array<Record<string, string>>> {
  const totalSec = endTimeSec - startTimeSec;
  const windowSec = Math.max(1, Math.floor(totalSec / 4));
  const parts: Array<Array<Record<string, string>>> = [];
  for (let i = 0; i < 4; i++) {
    const wStart = startTimeSec + i * windowSec;
    const wEnd = i === 3 ? endTimeSec : startTimeSec + (i + 1) * windowSec;
    if (wStart >= wEnd) break;
    const part = await fetchCloudWatch(version, wStart, wEnd).catch(() => []);
    console.log(
      `[CloudWatch] ${version} ventana ${i + 1}/4: ${part.length} filas`
    );
    if (part.length >= 10000) {
      console.warn(
        `[CloudWatch] ${version} ventana ${i + 1}/4 devolvió ${part.length} filas (límite 10k). Posible truncación para ese intervalo.`
      );
    }
    if (part.length === 0 && totalSec >= 86000) {
      console.warn(
        `[CloudWatch] ${version} ventana ${i + 1}/4: 0 filas (posible fallo o throttling).`
      );
    }
    parts.push(part);
    if (i < 3) await sleep(CLOUDWATCH_DELAY_MS);
  }
  const seen = new Set<string>();
  const merged: Array<Record<string, string>> = [];
  for (const row of parts.flat()) {
    const key = `${row["@timestamp"] ?? ""}\t${row["@message"] ?? ""}`;
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}

/** Fecha de hoy en zona México (UTC-6) como YYYY-MM-DD. */
function getTodayMexico(): string {
  const mexicoOffsetMs = 6 * 60 * 60 * 1000;
  const d = new Date(Date.now() - mexicoOffsetMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Suma días a una fecha YYYY-MM-DD. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Detecta si el error es por fecha fuera de retención o anterior a la creación del log group. Mismo criterio que el proceso original (catchEmpty en fetchAndIngestForDate): seguir con [] en lugar de fallar. */
function isOutOfRangeError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (
    msg.includes("InvalidParameterException") &&
    msg.includes("before the service was generally available")
  ) {
    return true;
  }
  return (
    msg.includes("MalformedQueryException") &&
    (msg.includes("before the log groups creation time") ||
      msg.includes("exceeds the log groups log retention"))
  );
}

/** Convierte ParsedRecord a documento de tabla fuente (importDate/importMonth fijados por unidad). */
function toSourceRecord(
  p: { referencia: string; monto: number; timestamp: string; fechaTransaccion: string; estatus: string; movimiento: string; tramiteId?: number },
  importDate: string,
  importMonth: string
): {
  importDate: string;
  importMonth: string;
  timestamp: string;
  referencia: string;
  monto: number;
  fechaTransaccion: string;
  estatus: string;
  movimiento: string;
  tramiteId?: number;
  rawData?: string;
} {
  return {
    importDate,
    importMonth,
    timestamp: p.timestamp,
    referencia: p.referencia,
    monto: p.monto,
    fechaTransaccion: p.fechaTransaccion,
    estatus: p.estatus,
    movimiento: p.movimiento,
    ...(p.tramiteId != null && { tramiteId: p.tramiteId }),
  };
}

const DETERMINISTIC_BATCH_SIZE = 100;

/**
 * Sincronización determinística para una fecha: conteo por hora, extracción por intervalos, persistencia en tablas fuente, verificación.
 * Usado por jobs cloudwatch_deterministic_sync_by_*.
 */
/** Epoch segundos para 2020-01-01 00:00:00 UTC (límite inferior razonable para queries). */
const MIN_QUERY_EPOCH_SEC = 1577836800;

export const runDeterministicSyncForDate = action({
  args: { date: v.string() },
  handler: async (ctx, { date: dateArg }): Promise<{
    date: string;
    bySource: Record<string, { expected: number; inserted: number }>;
    ok: boolean;
  }> => {
    const date = dateArg.slice(0, 10);
    const parts = date.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`runDeterministicSyncForDate: fecha inválida (esperado YYYY-MM-DD): ${dateArg}`);
    }
    const [y, mo, day] = parts;
    if (mo < 1 || mo > 12 || day < 1 || day > 31) {
      throw new Error(`runDeterministicSyncForDate: fecha inválida (mes/día): ${date}`);
    }
    const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
    const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
    const startTimeSec = Math.floor(startUtc.getTime() / 1000);
    const endTimeSec = Math.floor(endUtc.getTime() / 1000);
    if (!Number.isFinite(startTimeSec) || !Number.isFinite(endTimeSec)) {
      throw new Error(`runDeterministicSyncForDate: timestamps inválidos para ${date}`);
    }
    if (startTimeSec >= endTimeSec) {
      throw new Error(`runDeterministicSyncForDate: startTime >= endTime para ${date} (${startTimeSec} >= ${endTimeSec})`);
    }
    if (startTimeSec < MIN_QUERY_EPOCH_SEC || endTimeSec < MIN_QUERY_EPOCH_SEC) {
      throw new Error(
        `runDeterministicSyncForDate: rango de tiempo antes de 2020-01-01 (start=${startTimeSec} end=${endTimeSec}) para ${date}`
      );
    }
    console.log(
      `[runDeterministicSyncForDate] date=${date} startTimeSec=${startTimeSec} endTimeSec=${endTimeSec} (epoch seconds for CloudWatch)`
    );
    const importMonth = date.slice(0, 7);

    const bySource: Record<string, { expected: number; inserted: number }> = {};
    const sources: Array<"v1" | "v2" | "payment"> = ["v1", "v2", "payment"];

    for (const source of sources) {
      try {
        let buckets: HourBucket[];
        try {
          buckets = await countByHour(source, startTimeSec, endTimeSec);
        } catch (countErr) {
          if (isOutOfRangeError(countErr)) {
            // Mismo camino que diagnoseV2ForDate: count falla pero el fetch puede funcionar.
            const rows = await fetchCloudWatchWithWindows(source, startTimeSec, endTimeSec);
            const parsed =
              source === "payment"
                ? parsePayment(rows)
                : parseV1V2(rows, source);
            const records = parsed.map((p) => toSourceRecord(p, date, importMonth));
            while (true) {
              const del =
                source === "v1"
                  ? ((await ctx.runMutation(api.cloudwatchMutations.deleteCloudwatchSourceV1ByDate, { importDate: date })) as { deleted: number })
                  : source === "v2"
                    ? ((await ctx.runMutation(api.cloudwatchMutations.deleteCloudwatchSourceV2ByDate, { importDate: date })) as { deleted: number })
                    : ((await ctx.runMutation(api.cloudwatchMutations.deleteCloudwatchSourcePaymentByDate, { importDate: date })) as { deleted: number });
              if (del.deleted === 0) break;
            }
            let inserted = 0;
            for (let i = 0; i < records.length; i += DETERMINISTIC_BATCH_SIZE) {
              const batch = records.slice(i, i + DETERMINISTIC_BATCH_SIZE);
              const result =
                source === "v1"
                  ? ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourceV1Batch, { records: batch })) as { inserted: number })
                  : source === "v2"
                    ? ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourceV2Batch, { records: batch })) as { inserted: number })
                    : ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourcePaymentBatch, { records: batch })) as { inserted: number });
              inserted += result.inserted;
            }
            bySource[source] = { expected: inserted, inserted };
          } else {
            throw countErr;
          }
          await sleep(CLOUDWATCH_PAUSE_BETWEEN_SOURCES_MS);
          continue;
        }

        const intervals = buildExtractionIntervals(buckets);
        let expected = intervals.reduce((s, i) => s + i.expectedCount, 0);

        // Si el conteo dio 0 pero diagnose sí trae datos, usar el mismo camino: 4 ventanas (como diagnoseV2ForDate).
        const rowsForDay =
          expected > 0
            ? null
            : await fetchCloudWatchWithWindows(source, startTimeSec, endTimeSec);
        if (rowsForDay !== null) {
          expected = rowsForDay.length;
        }

        while (true) {
          const res =
            source === "v1"
              ? ((await ctx.runMutation(api.cloudwatchMutations.deleteCloudwatchSourceV1ByDate, { importDate: date })) as { deleted: number })
              : source === "v2"
                ? ((await ctx.runMutation(api.cloudwatchMutations.deleteCloudwatchSourceV2ByDate, { importDate: date })) as { deleted: number })
                : ((await ctx.runMutation(api.cloudwatchMutations.deleteCloudwatchSourcePaymentByDate, { importDate: date })) as { deleted: number });
          if (res.deleted === 0) break;
        }

        let inserted = 0;
        if (rowsForDay !== null) {
          const parsed =
            source === "payment"
              ? parsePayment(rowsForDay)
              : parseV1V2(rowsForDay, source);
          const records = parsed.map((p) => toSourceRecord(p, date, importMonth));
          for (let i = 0; i < records.length; i += DETERMINISTIC_BATCH_SIZE) {
            const batch = records.slice(i, i + DETERMINISTIC_BATCH_SIZE);
            const result =
              source === "v1"
                ? ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourceV1Batch, { records: batch })) as { inserted: number })
                : source === "v2"
                  ? ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourceV2Batch, { records: batch })) as { inserted: number })
                  : ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourcePaymentBatch, { records: batch })) as { inserted: number });
            inserted += result.inserted;
          }
          expected = inserted;
        } else {
          for (const iv of intervals) {
            const rows = await fetchCloudWatch(source, iv.startSec, iv.endSec);
            const parsed =
              source === "payment"
                ? parsePayment(rows)
                : parseV1V2(rows, source);
            const records = parsed.map((p) => toSourceRecord(p, date, importMonth));
            for (let i = 0; i < records.length; i += DETERMINISTIC_BATCH_SIZE) {
              const batch = records.slice(i, i + DETERMINISTIC_BATCH_SIZE);
              const result =
                source === "v1"
                  ? ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourceV1Batch, { records: batch })) as { inserted: number })
                  : source === "v2"
                    ? ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourceV2Batch, { records: batch })) as { inserted: number })
                    : ((await ctx.runMutation(api.cloudwatchMutations.ingestCloudwatchSourcePaymentBatch, { records: batch })) as { inserted: number });
              inserted += result.inserted;
            }
            if (iv.startSec < iv.endSec && rows.length > 0) await sleep(CLOUDWATCH_DELAY_MS);
          }
        }

        bySource[source] = { expected: inserted, inserted };
      } catch (e) {
        if (isOutOfRangeError(e)) {
          bySource[source] = { expected: 0, inserted: 0 };
        } else {
          throw e;
        }
      }
      await sleep(CLOUDWATCH_PAUSE_BETWEEN_SOURCES_MS);
    }

    return {
      date,
      bySource,
      ok: true,
    };
  },
});

type PaymentRecordForConsolidation = {
  referencia: string;
  monto: number;
  timestamp: string;
  fechaTransaccion: string;
  logSource: "v1" | "v2" | "payment";
  movimiento: string;
  estatus: string;
  tramiteId?: number;
  importMonth: string;
  importDate: string;
};

/**
 * Consolidación: lee las 3 tablas fuente (cloudwatchSourceV1/V2/Payment) para un rango de fechas,
 * agrupa por referencia con prioridad (RuleSet dedup), escribe en paymentRecords.
 * Ejecutar después de sync determinístico para tener paymentRecords actualizados.
 */
export const consolidateFromSourceTables = action({
  args: {
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (
    ctx,
    { fromDate, toDate }
  ): Promise<{
    fromDate: string;
    toDate: string;
    datesProcessed: number;
    totalInserted: number;
    byDate: Record<string, number>;
  }> => {
    const dates: string[] = [];
    let d = fromDate.slice(0, 10);
    while (d <= toDate.slice(0, 10)) {
      dates.push(d);
      if (d === toDate.slice(0, 10)) break;
      d = addDays(d, 1);
    }

    const priorityList = (await ctx.runQuery(api.ruleSets.getDedupOrderForCloudWatch, {})) as string[];
    const order: Record<string, number> = {};
    priorityList.forEach((src: string, i: number) => {
      order[src] = i;
    });
    if (Object.keys(order).length === 0) Object.assign(order, { payment: 0, v2: 1, v1: 2 });

    const byDate: Record<string, number> = {};
    let totalInserted = 0;

    for (const date of dates) {
      const all: PaymentRecordForConsolidation[] = [];
      let cursor: string | null = null;
      do {
        const r1 = (await ctx.runQuery(api.cloudwatchQueries.listCloudwatchSourceV1ByDate, {
          importDate: date,
          cursor: cursor ?? undefined,
          numItems: 500,
        })) as { page: PaymentRecordForConsolidation[]; isDone: boolean; continueCursor: string | null };
        all.push(...r1.page);
        if (r1.isDone) break;
        cursor = r1.continueCursor;
      } while (cursor);
      cursor = null;
      do {
        const r2 = (await ctx.runQuery(api.cloudwatchQueries.listCloudwatchSourceV2ByDate, {
          importDate: date,
          cursor: cursor ?? undefined,
          numItems: 500,
        })) as { page: PaymentRecordForConsolidation[]; isDone: boolean; continueCursor: string | null };
        all.push(...r2.page);
        if (r2.isDone) break;
        cursor = r2.continueCursor;
      } while (cursor);
      cursor = null;
      do {
        const r3 = (await ctx.runQuery(api.cloudwatchQueries.listCloudwatchSourcePaymentByDate, {
          importDate: date,
          cursor: cursor ?? undefined,
          numItems: 500,
        })) as { page: PaymentRecordForConsolidation[]; isDone: boolean; continueCursor: string | null };
        all.push(...r3.page);
        if (r3.isDone) break;
        cursor = r3.continueCursor;
      } while (cursor);

      const byRef = new Map<string, { logSource: string; rec: PaymentRecordForConsolidation }>();
      for (const rec of all) {
        const existing = byRef.get(rec.referencia);
        if (
          !existing ||
          (order[rec.logSource] ?? 99) < (order[existing.logSource] ?? 99)
        ) {
          byRef.set(rec.referencia, { logSource: rec.logSource, rec });
        }
      }

      let deleteCount = 0;
      while (true) {
        const res = (await ctx.runMutation(api.cloudwatchMutations.deletePaymentsByDate, {
          date,
        })) as { deleted: number };
        deleteCount += res.deleted;
        if (res.deleted === 0) break;
      }

      const records = Array.from(byRef.values()).map((x) => x.rec);
      let inserted = 0;
      const BATCH = 100;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const result = (await ctx.runMutation(api.cloudwatchMutations.ingestPaymentBatch, {
          records: batch,
        })) as { inserted: number; skipped: number };
        inserted += result.inserted;
      }
      byDate[date] = inserted;
      totalInserted += inserted;
    }

    return {
      fromDate,
      toDate,
      datesProcessed: dates.length,
      totalInserted,
      byDate,
    };
  },
});

export const fetchAndIngestForDate = action({
  args: {
    date: v.string(),
    /** Si true, no actualiza monthStats (evita OCC cuando muchas unidades en paralelo). Recálculo al finalizar el job. */
    skipMonthStatsUpdate: v.optional(v.boolean()),
  },
  handler: async (ctx, { date, skipMonthStatsUpdate }) => {
    const startMs = Date.now();
    const checkTime = (): void => {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
        throw new Error(
          "Límite de tiempo alcanzado (550s). Para fechas con muchos registros, ejecuta en horarios de menor carga o contacta soporte."
        );
      }
    };

    // Borrar datos previos por importDate (en lotes, límite 4096 lecturas/mutación)
    let deleteByDateTotal = 0;
    while (true) {
      checkTime();
      const res = (await ctx.runMutation(api.cloudwatchMutations.deletePaymentsByDate, {
        date,
      })) as { deleted: number };
      deleteByDateTotal += res.deleted;
      if (res.deleted === 0) break;
    }
    console.log(`[SENTINEL] Paso 0 - deleteByDate: eliminados=${deleteByDateTotal} (registros con importDate=${date} ya no están en Convex)`);

    // Hora México (UTC-6): día local 00:00-23:59:59
    // 00:00 México = 06:00 UTC | 23:59:59 México = 05:59:59.999 UTC día sig
    const [y, mo, day] = date.split("-").map(Number);
    const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
    const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
    const startTimeSec = Math.floor(startUtc.getTime() / 1000);
    const endTimeSec = Math.floor(endUtc.getTime() / 1000);

    type Rec = {
      referencia: string;
      monto: number;
      timestamp: string;
      fechaTransaccion: string;
      logSource: "v1" | "v2" | "payment";
      movimiento: string;
      estatus: string;
      tramiteId?: number;
      importMonth: string;
      importDate: string;
    };
    const byRef = new Map<string, { logSource: string; rec: Rec }>();
    // Prioridad desde RuleSet (dedup/cloudwatch) si existe; si no, default Payment > V2 > V1
    const priorityList = await ctx.runQuery(api.ruleSets.getDedupOrderForCloudWatch, {});
    const order: Record<string, number> = {};
    priorityList.forEach((src: string, i: number) => {
      order[src] = i;
    });
    if (Object.keys(order).length === 0) Object.assign(order, { payment: 0, v2: 1, v1: 2 });

    checkTime();
    // Fetch las 3 fuentes en secuencia con pausa para evitar ThrottlingException (Rate exceeded) de AWS
    // V2 (y en su caso v1/payment) puede fallar con MalformedQueryException para fechas antiguas:
    // la fecha queda fuera de la retención del log group o es anterior a su creación. Es esperado;
    // devolvemos [] y seguimos.
    const catchEmpty = (e: unknown, label: string): Array<Record<string, string>> => {
      const msg = e instanceof Error ? e.message : String(e);
      const isOutOfRange =
        msg.includes("MalformedQueryException") &&
        (msg.includes("before the log groups creation time") ||
          msg.includes("exceeds the log groups log retention"));
      if (isOutOfRange) {
        console.warn(`[${label}] Sin datos para esta fecha (fuera de retención o anterior al log group):`, date);
      } else {
        console.error(`[${label}] Error:`, e);
      }
      return [];
    };
    // Orden: V2 → V1 → Payment. V2 primero para que tenga el mismo contexto que diagnoseV2ForDate
    // (cero llamadas previas a CloudWatch) y no sufra throttling acumulado; luego V1, luego Payment.
    const rowsV2 = await fetchCloudWatchWithWindows("v2", startTimeSec, endTimeSec).catch((e) =>
      catchEmpty(e, "v2")
    );
    let rowsV2Final = rowsV2;
    if (rowsV2.length === 0 && date >= "2024-01-01") {
      console.warn(
        `[SENTINEL] [v2] 0 filas para date=${date}. Reintento 1/2 en 15s (posible throttling).`
      );
      await sleep(15_000);
      rowsV2Final = await fetchCloudWatchWithWindows("v2", startTimeSec, endTimeSec).catch((e) =>
        catchEmpty(e, "v2-retry1")
      );
      if (rowsV2Final.length === 0) {
        console.warn(`[SENTINEL] [v2] Sigue 0 filas. Reintento 2/2 en 30s.`);
        await sleep(30_000);
        rowsV2Final = await fetchCloudWatchWithWindows("v2", startTimeSec, endTimeSec).catch((e) =>
          catchEmpty(e, "v2-retry2")
        );
      }
      if (rowsV2Final.length > 0) {
        console.log(`[SENTINEL] [v2] Reintento ok: ${rowsV2Final.length} filas para date=${date}`);
      } else {
        console.warn(`[SENTINEL] [v2] fetch devolvió 0 filas tras 2 reintentos para date=${date}.`);
      }
    } else if (rowsV2.length > 0 && rowsV2.length < 5000 && date >= "2026-01-01") {
      console.warn(
        `[SENTINEL] [v2] Conteo bajo (${rowsV2.length}) para date=${date}. Reintento en 10s.`
      );
      await sleep(10_000);
      const retryV2 = await fetchCloudWatchWithWindows("v2", startTimeSec, endTimeSec).catch((e) =>
        catchEmpty(e, "v2-retry-low")
      );
      if (retryV2.length > rowsV2Final.length) {
        rowsV2Final = retryV2;
        console.log(`[SENTINEL] [v2] Reintento mejor: ${rowsV2Final.length} filas (antes ${rowsV2.length}) para date=${date}`);
      }
    } else if (rowsV2.length === 0) {
      console.warn(
        `[SENTINEL] [v2] fetch devolvió 0 filas para date=${date} (fecha antigua o sin datos).`
      );
    }
    console.log(`[CloudWatch] Fuente v2 completada (${rowsV2Final.length} filas). Pausa ${CLOUDWATCH_PAUSE_BETWEEN_SOURCES_MS / 1000}s antes de siguiente fuente.`);
    await sleep(CLOUDWATCH_PAUSE_BETWEEN_SOURCES_MS);
    checkTime();
    const rowsV1 = await fetchCloudWatchWithWindows("v1", startTimeSec, endTimeSec).catch((e) =>
      catchEmpty(e, "v1")
    );
    console.log(`[CloudWatch] Fuente v1 completada (${rowsV1.length} filas). Pausa ${CLOUDWATCH_PAUSE_BETWEEN_SOURCES_MS / 1000}s antes de siguiente fuente.`);
    await sleep(CLOUDWATCH_PAUSE_BETWEEN_SOURCES_MS);
    checkTime();
    const rowsPayment = await fetchCloudWatchWithWindows("payment", startTimeSec, endTimeSec).catch((e) =>
      catchEmpty(e, "payment")
    );

    const rawBySource = {
      v1: rowsV1.length,
      v2: rowsV2Final.length,
      payment: rowsPayment.length,
    };
    const rawSentinelInV2: string[] = [];
    for (const row of rowsV2Final) {
      const msg = row["@message"] ?? "";
      for (const ref of SENTINEL_REFERENCIAS) {
        if (msg.includes(ref) && !rawSentinelInV2.includes(ref)) rawSentinelInV2.push(ref);
      }
    }
    console.log(`[SENTINEL] Paso 1 - Fetch: raw v1=${rawBySource.v1} v2=${rawBySource.v2} payment=${rawBySource.payment}. Sentinela en raw V2: ${rawSentinelInV2.length}/5`, rawSentinelInV2);

    const parsedBySource = { v1: 0, v2: 0, payment: 0 };

    for (const [version, rows] of [
      ["v1", rowsV1],
      ["v2", rowsV2Final],
      ["payment", rowsPayment],
    ] as const) {
      const parsed =
        version === "payment"
          ? parsePayment(rows)
          : parseV1V2(rows, version);

      parsedBySource[version] = parsed.length;

      for (const p of parsed) {
        const existing = byRef.get(p.referencia);
        if (
          !existing ||
          order[version] < order[existing.logSource as keyof typeof order]
        ) {
          byRef.set(p.referencia, {
            logSource: version,
            rec: {
              referencia: p.referencia,
              monto: p.monto,
              timestamp: p.timestamp,
              fechaTransaccion: p.fechaTransaccion,
              logSource: p.logSource,
              movimiento: p.movimiento,
              estatus: p.estatus,
              tramiteId: p.tramiteId,
              importMonth: p.importMonth,
              importDate: p.importDate,
            },
          });
        }
      }
    }

    const parsedSentinelV2: string[] = [];
    for (const [version, rows] of [
      ["v2", rowsV2Final],
    ] as const) {
      const parsed = parseV1V2(rows, version);
      for (const p of parsed) {
        if (SENTINEL_REFERENCIAS.includes(p.referencia) && !parsedSentinelV2.includes(p.referencia)) {
          parsedSentinelV2.push(p.referencia);
        }
      }
    }
    console.log(`[SENTINEL] Paso 2 - Parse: parsed v1=${parsedBySource.v1} v2=${parsedBySource.v2} payment=${parsedBySource.payment}. Sentinela en parseados V2: ${parsedSentinelV2.length}/5`, parsedSentinelV2);

    const refsKeptBySource = { v1: 0, v2: 0, payment: 0 };
    for (const { rec } of byRef.values()) {
      refsKeptBySource[rec.logSource as keyof typeof refsKeptBySource]++;
    }
    const refsDiscardedBySource = {
      v1: Math.max(0, parsedBySource.v1 - refsKeptBySource.v1),
      v2: Math.max(0, parsedBySource.v2 - refsKeptBySource.v2),
      payment: Math.max(0, parsedBySource.payment - refsKeptBySource.payment),
    };

    const records = Array.from(byRef.values()).map((x) => x.rec);
    const byRefRefs = records.map((r) => r.referencia);
    const sentinelInByRef = sentinelIn(byRefRefs);
    const sentinelMissingByRef = sentinelMissing(byRefRefs);
    console.log(`[SENTINEL] Paso 3 - byRef: total refs=${byRef.size}. Sentinela en byRef: ${sentinelInByRef.length}/5`, sentinelInByRef, sentinelMissingByRef.length ? `faltan: ${sentinelMissingByRef.join(", ")}` : "");

    // Registros sin fecha parseable no deben caer en un mes fijo (ej. 2026-01): asignar el día que estamos sincronizando.
    const syncMonth = date.substring(0, 7);
    for (const r of records) {
      if (!r.importDate?.trim()) {
        r.importDate = date;
        r.importMonth = syncMonth;
      }
      if (!r.importMonth?.trim()) {
        r.importMonth = syncMonth;
        if (!r.importDate?.trim()) r.importDate = date;
      }
    }
    const referencias = records.map((r) => r.referencia);
    const sentinelInReferencias = sentinelIn(referencias);
    console.log(`[SENTINEL] Paso 4 - records (post normalizar importDate/importMonth): total=${records.length}. Sentinela en lista a insertar: ${sentinelInReferencias.length}/5`, sentinelInReferencias);

    // Borrar en lotes: cada mutación hace 1 query + 1 delete por referencia.
    // Lotes grandes (500) pueden superar el timeout de mutación (~10s); usar 80 para estar seguros.
    const DELETE_BATCH = 80;
    let deleteByRefTotal = 0;
    for (let i = 0; i < referencias.length; i += DELETE_BATCH) {
      checkTime();
      const batch = referencias.slice(i, i + DELETE_BATCH);
      const res = (await ctx.runMutation(
        api.cloudwatchMutations.deletePaymentsByReferencias,
        { referencias: batch }
      )) as { deleted: number };
      deleteByRefTotal += res.deleted;
    }
    console.log(`[SENTINEL] Paso 5 - deleteByReferencias: total borrados=${deleteByRefTotal}. (Sentinela en referencias a borrar: ${sentinelInReferencias.length})`);

    let totalInserted = 0;
    let totalSkipped = 0;
    const BATCH = 100;

    for (let i = 0; i < records.length; i += BATCH) {
      checkTime();
      const batch = records.slice(i, i + BATCH);
      const batchRefs = batch.map((r) => r.referencia);
      const sentinelInBatch = sentinelIn(batchRefs);
      const result = (await ctx.runMutation(api.cloudwatchMutations.ingestPaymentBatch, {
        records: batch,
      })) as { inserted: number; skipped: number };
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      if (sentinelInBatch.length > 0) {
        console.log(`[SENTINEL] Paso 6 - insert batch ${i / BATCH + 1}: inserted=${result.inserted} skipped=${result.skipped}. Sentinela en este batch:`, sentinelInBatch);
      }
    }
    console.log(`[SENTINEL] Paso 6 - insert total: inserted=${totalInserted} skipped=${totalSkipped}`);

    const postInsertLookup = (await ctx.runQuery(api.cloudwatchQueries.getPaymentRecordDetailsForReferencias, {
      referencias: SENTINEL_REFERENCIAS,
    })) as Record<string, { importMonth: string; fechaTransaccion: string }>;
    const sentinelInConvex = SENTINEL_REFERENCIAS.filter((ref) => postInsertLookup[ref]);
    const sentinelMissingInConvex = SENTINEL_REFERENCIAS.filter((ref) => !postInsertLookup[ref]);
    const sentinelWrongMonth = sentinelInConvex.filter((ref) => {
      const m = (postInsertLookup[ref]?.importMonth ?? "").substring(0, 7);
      return m !== syncMonth;
    });
    console.log(`[SENTINEL] Paso 7 - post-insert: en Convex ${sentinelInConvex.length}/5`, sentinelInConvex);
    if (sentinelMissingInConvex.length > 0) {
      console.log(`[SENTINEL] Paso 7 - post-insert: NO están en Convex:`, sentinelMissingInConvex);
    }
    if (sentinelWrongMonth.length > 0) {
      console.log(`[SENTINEL] Paso 7 - post-insert: en Convex pero importMonth distinto a ${syncMonth}:`, sentinelWrongMonth.map((ref) => ({ ref, importMonth: postInsertLookup[ref]?.importMonth })));
    }

    const month = date.substring(0, 7);
    const config = (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
      descriptions: {},
      aliases: {},
    };
    const byMov = new Map<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    >();
    let v1 = 0,
      v2 = 0,
      payment = 0;
    let v1Monto = 0,
      v2Monto = 0,
      paymentMonto = 0;
    for (const r of records) {
      if (r.logSource === "v1") {
        v1++;
        v1Monto += r.monto;
      } else if (r.logSource === "v2") {
        v2++;
        v2Monto += r.monto;
      } else {
        payment++;
        paymentMonto += r.monto;
      }
      const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
      const cur = byMov.get(mov) ?? {
        count: 0,
        monto: 0,
        v1: 0,
        v2: 0,
        payment: 0,
      };
      cur.count++;
      cur.monto += r.monto;
      if (r.logSource === "v1") cur.v1++;
      else if (r.logSource === "v2") cur.v2++;
      else cur.payment++;
      byMov.set(mov, cur);
    }
    const dayEntry = {
      date,
      count: records.length,
      monto: records.reduce((s, r) => s + r.monto, 0),
      v1,
      v2,
      payment,
      v1Monto,
      v2Monto,
      paymentMonto,
      byMovimiento: Array.from(byMov.entries()).map(([movimiento, d]) => ({
        movimiento,
        ...d,
      })),
      refs: [], // Omitir refs para evitar payload > 1 MiB (límite Convex)
    };
    if (!skipMonthStatsUpdate) {
      await ctx.runMutation(api.cloudwatchMutations.updateMonthStatsFromDay, {
        month,
        dayEntry,
      });
    }

    const truncationRisk =
      rawBySource.v1 >= 10000 ||
      rawBySource.v2 >= 10000 ||
      rawBySource.payment >= 10000;
    await ctx.runMutation(api.cloudwatchMutations.recordCloudwatchIngestionAudit, {
      audit: {
        date,
        rawBySource,
        parsedBySource,
        refsKeptBySource,
        refsDiscardedBySource,
        deleted: deleteByDateTotal + deleteByRefTotal,
        inserted: totalInserted,
        skipped: totalSkipped,
        truncationRisk,
      },
    });

    return {
      date,
      deleted: deleteByDateTotal + deleteByRefTotal,
      totalRecords: records.length,
      inserted: totalInserted,
      skipped: totalSkipped,
      audit: {
        rawBySource,
        parsedBySource,
        refsKeptBySource,
        refsDiscardedBySource,
        truncationRisk,
      },
    };
  },
});

/** Extracción incremental CloudWatch: sincroniza desde (marca de agua + 1 día) hasta hoy (México). Actualiza la marca de agua al final. */
export const fetchCloudwatchIncremental = action({
  args: {},
  handler: async (ctx): Promise<{
    inserted: number;
    deleted: number;
    daysProcessed: number;
    newWatermark: string | null;
    message?: string;
  }> => {
    const watermarkDoc = (await ctx.runQuery(
      api.cloudwatchQueries.getCloudwatchWatermark,
      {}
    )) as { lastSyncedDate: string | null };
    const lastSynced = watermarkDoc?.lastSyncedDate ?? null;
    if (!lastSynced) {
      return {
        inserted: 0,
        deleted: 0,
        daysProcessed: 0,
        newWatermark: null,
        message:
          "No hay marca de agua. Ejecuta primero Carga completa, Carga por meses o Carga desde fecha.",
      };
    }
    const today = getTodayMexico();
    const dates: string[] = [];
    let d = addDays(lastSynced, 1);
    while (d <= today) {
      dates.push(d);
      d = addDays(d, 1);
    }
    if (dates.length === 0) {
      return {
        inserted: 0,
        deleted: 0,
        daysProcessed: 0,
        newWatermark: lastSynced,
        message: "Ya estás al día. No hay días nuevos que sincronizar.",
      };
    }
    let totalInserted = 0;
    let totalDeleted = 0;
    let lastSuccessDate = lastSynced;
    const startMs = Date.now();
    const ACTION_LIMIT_MS = 540_000;
    for (const dateStr of dates) {
      if (Date.now() - startMs > ACTION_LIMIT_MS) {
        await ctx.runMutation(api.cloudwatchMutations.setCloudwatchWatermark, {
          lastSyncedDate: lastSuccessDate,
        });
        return {
          inserted: totalInserted,
          deleted: totalDeleted,
          daysProcessed: dates.indexOf(dateStr),
          newWatermark: lastSuccessDate,
          message: `Límite de tiempo alcanzado. Sincronizados hasta ${lastSuccessDate}. Vuelve a ejecutar Incremental para continuar.`,
        };
      }
      try {
        const res = (await ctx.runAction(api.cloudwatchActions.fetchAndIngestForDate, {
          date: dateStr,
        })) as { inserted: number; deleted: number };
        totalInserted += res.inserted;
        totalDeleted += res.deleted;
        lastSuccessDate = dateStr;
      } catch (err) {
        await ctx.runMutation(api.cloudwatchMutations.setCloudwatchWatermark, {
          lastSyncedDate: lastSuccessDate,
        });
        throw err;
      }
    }
    await ctx.runMutation(api.cloudwatchMutations.setCloudwatchWatermark, {
      lastSyncedDate: lastSuccessDate,
    });
    return {
      inserted: totalInserted,
      deleted: totalDeleted,
      daysProcessed: dates.length,
      newWatermark: lastSuccessDate,
    };
  },
});

/** Regenera monthStats desde paymentRecords. Útil cuando ya hay datos pero monthStats está vacío. */
export const recreateMonthStatsFromPaymentRecords = action({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const startTime = Date.now();
    const PAGE_SIZE = 1000;
    let cursor: string | null = null;

    const referenciasSet = new Set<string>();
    const diasSet = new Set<string>();
    const porFuente: Record<string, number> = { v1: 0, v2: 0, payment: 0 };
    const montoPorFuente: Record<string, number> = { v1: 0, v2: 0, payment: 0 };
    const byDay = new Map<
      string,
      {
        count: number;
        monto: number;
        v1: number;
        v2: number;
        payment: number;
        v1Monto: number;
        v2Monto: number;
        paymentMonto: number;
        byMovimiento: Map<
          string,
          { count: number; monto: number; v1: number; v2: number; payment: number }
        >;
        refs: string[];
      }
    >();
    const config = (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
      descriptions: {},
      aliases: {},
    };
    const byMovimiento = new Map<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    >();

    const [year, mon] = month.split("-").map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      byDay.set(dateStr, {
        count: 0,
        monto: 0,
        v1: 0,
        v2: 0,
        payment: 0,
        v1Monto: 0,
        v2Monto: 0,
        paymentMonto: 0,
        byMovimiento: new Map(),
        refs: [],
      });
    }

    type Rec = {
      referencia: string;
      monto: number;
      timestamp: string;
      importDate?: string;
      logSource: "v1" | "v2" | "payment";
      movimiento: string;
    };

    while (true) {
      if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
        throw new Error(
          "Límite de tiempo alcanzado (550s). Mes con demasiados registros."
        );
      }

      const result = (await ctx.runQuery(
        api.cloudwatchQueries.getPaymentsByMonthPaginated,
        {
          month,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        }
      )) as {
        page: Rec[];
        isDone: boolean;
        continueCursor: string | null;
      };

      for (const r of result.page) {
        referenciasSet.add(r.referencia);
        const dateStr = r.importDate ?? r.timestamp?.substring(0, 10) ?? "";
        if (dateStr) diasSet.add(dateStr);

        porFuente[r.logSource] = (porFuente[r.logSource] || 0) + 1;
        montoPorFuente[r.logSource] =
          (montoPorFuente[r.logSource] || 0) + r.monto;

        const dayData = byDay.get(dateStr);
        if (dayData) {
          dayData.count += 1;
          dayData.monto += r.monto;
          dayData.refs.push(r.referencia);
          if (r.logSource === "v1") {
            dayData.v1 += 1;
            dayData.v1Monto += r.monto;
          } else if (r.logSource === "v2") {
            dayData.v2 += 1;
            dayData.v2Monto += r.monto;
          } else {
            dayData.payment += 1;
            dayData.paymentMonto += r.monto;
          }

          const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
          const movCur = dayData.byMovimiento.get(mov) ?? {
            count: 0,
            monto: 0,
            v1: 0,
            v2: 0,
            payment: 0,
          };
          movCur.count += 1;
          movCur.monto += r.monto;
          if (r.logSource === "v1") movCur.v1 += 1;
          else if (r.logSource === "v2") movCur.v2 += 1;
          else movCur.payment += 1;
          dayData.byMovimiento.set(mov, movCur);
        }

        const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
        const movGlobal = byMovimiento.get(mov) ?? {
          count: 0,
          monto: 0,
          v1: 0,
          v2: 0,
          payment: 0,
        };
        movGlobal.count += 1;
        movGlobal.monto += r.monto;
        if (r.logSource === "v1") movGlobal.v1 += 1;
        else if (r.logSource === "v2") movGlobal.v2 += 1;
        else movGlobal.payment += 1;
        byMovimiento.set(mov, movGlobal);
      }

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    const totalPagos = Array.from(byDay.values()).reduce((s, d) => s + d.count, 0);
    const montoTotal = Array.from(byDay.values()).reduce((s, d) => s + d.monto, 0);
    const diasConDatos = Array.from(byDay.values()).filter((d) => d.count > 0)
      .length;
    const promedioDiario =
      diasConDatos > 0 ? Math.round(totalPagos / diasConDatos) : 0;

    const dayEntries = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        count: d.count,
        monto: d.monto,
        v1: d.v1,
        v2: d.v2,
        payment: d.payment,
        v1Monto: d.v1Monto,
        v2Monto: d.v2Monto,
        paymentMonto: d.paymentMonto,
        byMovimiento: Array.from(d.byMovimiento.entries()).map(
          ([movimiento, data]) => ({ movimiento, ...data })
        ),
        refs: [], // Omitir refs para evitar payload > 1 MiB; referenciasUnicas ya en kpis
      }));

    const dailyBreakdown = dayEntries.map((e) => ({
      date: e.date,
      count: e.count,
      monto: e.monto,
      v1: e.v1,
      v2: e.v2,
      payment: e.payment,
      v1Monto: e.v1Monto,
      v2Monto: e.v2Monto,
      paymentMonto: e.paymentMonto,
    }));

    const movementStats = Array.from(byMovimiento.entries())
      .map(([movimiento, data]) => ({ movimiento, ...data }))
      .sort((a, b) => b.count - a.count);

    const sources = ["v1", "v2", "payment"] as const;
    const sourceStats = sources.map((source) => {
      const count = porFuente[source] ?? 0;
      const monto = montoPorFuente[source] ?? 0;
      return {
        source,
        count,
        monto,
        pctCount: totalPagos > 0 ? (count / totalPagos) * 100 : 0,
        pctMonto: montoTotal > 0 ? (monto / montoTotal) * 100 : 0,
      };
    });

    const byDate = dayEntries
      .filter((e) => e.count > 0)
      .map((e) => ({ date: e.date, count: e.count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    await ctx.runMutation(api.cloudwatchMutations.setMonthStatsFromAggregation, {
      payload: {
        month,
        dayEntries,
        kpis: {
          totalPagos,
          montoTotal,
          referenciasUnicas: referenciasSet.size,
          promedioDiario,
          diasConDatos,
          porFuente,
        },
        dailyBreakdown,
        movementStats,
        sourceStats,
        ingestionStatus: {
          totalRecords: totalPagos,
          daysWithData: byDate.length,
          byDate,
        },
      },
    });

    return {
      month,
      totalPagos,
      montoTotal,
      referenciasUnicas: referenciasSet.size,
    };
  },
});

/** Regenera monthStats desde paymentRecords para todos los meses que ya tienen estadísticas. Para forzar recálculo desde la UI. */
export const recreateAllMonthStatsFromPaymentRecords = action({
  args: {},
  handler: async (ctx) => {
    const list = (await ctx.runQuery(api.cloudwatchQueries.getAllMonthsStatus, {})) as { month: string }[];
    const months = list.map((r) => r.month).sort();
    const results: { month: string; totalPagos?: number; error?: string }[] = [];
    for (const month of months) {
      try {
        const r = (await ctx.runAction(api.cloudwatchActions.recreateMonthStatsFromPaymentRecords, {
          month,
        })) as { totalPagos: number };
        results.push({ month, totalPagos: r.totalPagos });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ month, error: msg });
      }
    }
    return { monthsProcessed: results.length, results };
  },
});

/** Genera lista de meses YYYY-MM entre start y end inclusive. */
function generateMonthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/**
 * Verifica si hay referencias duplicadas en paymentRecords.
 * Itera por mes para respetar límites de lectura.
 */
export const checkDuplicateReferencias = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit: limitArg }) => {
    const maxResults = limitArg ?? 50;
    const months = generateMonthRange("2024-01", "2026-02");
    const countByRef = new Map<string, number>();

    for (const month of months) {
      let cursor: string | undefined;
      do {
        const result = await ctx.runQuery(api.cloudwatchQueries.getPaymentRecordsPageByMonth, {
          month,
          cursor,
          numItems: 5000,
        });
        for (const ref of result.page) {
          countByRef.set(ref, (countByRef.get(ref) ?? 0) + 1);
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);
    }

    const duplicates: Array<{ referencia: string; count: number }> = [];
    for (const [ref, count] of countByRef) {
      if (count > 1) {
        duplicates.push({ referencia: ref, count });
      }
    }

    duplicates.sort((a, b) => b.count - a.count);

    let totalRecords = 0;
    for (const [, c] of countByRef) {
      totalRecords += c;
    }

    return {
      totalRecords,
      uniqueReferencias: countByRef.size,
      duplicateReferencias: duplicates.length,
      totalDuplicateRecords: duplicates.reduce((s, d) => s + d.count, 0),
      top: duplicates.slice(0, maxResults),
    };
  },
});

/**
 * Elimina datos de febrero 2026 del día 9 en adelante (aún no han ocurrido).
 * Borra paymentRecords, regenera monthStats y agregados (dailyData, etc.).
 */
export const trimFebruary2026FutureData = action({
  args: {},
  handler: async (ctx) => {
    const month = "2026-02";
    const minDateToDelete = "2026-02-09";
    const PAGE_SIZE = 500;
    const BATCH_DELETE = 400;
    let cursor: string | null = null;
    let totalDeleted = 0;

    // 1. Eliminar paymentRecords con fechaTransaccion >= 2026-02-09
    while (true) {
      const result = (await ctx.runQuery(
        api.cloudwatchQueries.getPaymentsByMonthPaginated,
        {
          month,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        }
      )) as {
        page: Array<{ _id: Id<"paymentRecords">; fechaTransaccion: string }>;
        isDone: boolean;
        continueCursor: string | null;
      };

      const toDelete = result.page
        .filter((r) => r.fechaTransaccion >= minDateToDelete)
        .map((r) => r._id);

      for (let i = 0; i < toDelete.length; i += BATCH_DELETE) {
        const batch = toDelete.slice(i, i + BATCH_DELETE);
        const res = await ctx.runMutation(api.cloudwatchMutations.deletePaymentsByIds, {
          ids: batch,
        });
        totalDeleted += res.deleted;
      }

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    // 2. Regenerar monthStats desde paymentRecords
    await ctx.runAction(api.cloudwatchActions.recreateMonthStatsFromPaymentRecords, {
      month,
    });

    // 3. Regenerar agregados (dailyData, rawHourlyData, etc.)
    await ctx.runAction(api.aggregatesCloudwatchETL.buildCloudwatchAggregates, {
      months: [month],
    });

    return {
      paymentRecordsDeleted: totalDeleted,
      monthStatsRegenerated: true,
      aggregatesRegenerated: true,
    };
  },
});

/**
 * Diagnóstico en Convex: consulta CloudWatch V2 para una fecha, comprueba si las referencias
 * sentinela aparecen en los @message crudos y si el parser las extrae. Así se distingue si el
 * fallo está en el parser o en la escritura a Convex.
 *
 * Uso: npx convex run cloudwatchActions:diagnoseV2ForDate '{"date":"2026-02-16"}'
 */
export const diagnoseV2ForDate = action({
  args: { date: v.string() },
  handler: async (_ctx, { date }): Promise<{
    date: string;
    rawRowCount: number;
    sentinelRefsFound: string[];
    sentinelRefsMissing: string[];
    parsedRowCount: number;
    parsedSentinelRefsFound: string[];
    parsedSentinelRefsMissing: string[];
    logGroupConfigured: boolean;
    logGroupHint: string;
  }> => {
    const logGroup = LOG_GROUPS.v2;
    const logGroupConfigured = Boolean(logGroup?.trim());
    const logGroupHint = logGroupConfigured
      ? `${logGroup.slice(0, 20)}...${logGroup.slice(-8)}`
      : "(no configurado)";

    if (!logGroupConfigured) {
      return {
        date,
        rawRowCount: 0,
        sentinelRefsFound: [],
        sentinelRefsMissing: [...SENTINEL_REFERENCIAS],
        parsedRowCount: 0,
        parsedSentinelRefsFound: [],
        parsedSentinelRefsMissing: [...SENTINEL_REFERENCIAS],
        logGroupConfigured: false,
        logGroupHint,
      };
    }

    const [y, mo, day] = date.split("-").map(Number);
    const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
    const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
    const startTimeSec = Math.floor(startUtc.getTime() / 1000);
    const endTimeSec = Math.floor(endUtc.getTime() / 1000);

    const rawRows = await fetchCloudWatchWithWindows("v2", startTimeSec, endTimeSec);
    const found = new Set<string>();
    for (const row of rawRows) {
      const msg = row["@message"] ?? "";
      for (const ref of SENTINEL_REFERENCIAS) {
        if (msg.includes(ref)) found.add(ref);
      }
    }
    const sentinelRefsFound = [...found];
    const sentinelRefsMissing = SENTINEL_REFERENCIAS.filter((r) => !found.has(r));

    // Paso 2: parsear con parseV1V2 y comprobar si las sentinela salen en el resultado
    const parsed = parseV1V2(rawRows, "v2");
    const parsedFound = new Set<string>();
    for (const rec of parsed) {
      if (SENTINEL_REFERENCIAS.includes(rec.referencia)) parsedFound.add(rec.referencia);
    }
    const parsedSentinelRefsFound = [...parsedFound];
    const parsedSentinelRefsMissing = SENTINEL_REFERENCIAS.filter((r) => !parsedFound.has(r));

    return {
      date,
      rawRowCount: rawRows.length,
      sentinelRefsFound,
      sentinelRefsMissing,
      parsedRowCount: parsed.length,
      parsedSentinelRefsFound,
      parsedSentinelRefsMissing,
      logGroupConfigured: true,
      logGroupHint,
    };
  },
});
