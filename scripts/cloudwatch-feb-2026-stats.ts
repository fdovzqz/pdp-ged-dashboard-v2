/**
 * Consulta CloudWatch Logs Insights para las 3 fuentes (V1, V2, Payment),
 * aplica deduplicación por referencia (prioridad: payment > v2 > v1)
 * y devuelve conteo y suma de montos para un rango de fechas (hora México).
 *
 * Uso: pnpm exec tsx scripts/cloudwatch-feb-2026-stats.ts
 *
 * Requiere en .env.local: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 * CLOUDWATCH_LOG_GROUP_V1, CLOUDWATCH_LOG_GROUP_V2, CLOUDWATCH_LOG_GROUP_PAYMENT
 */

import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import * as fs from "fs";
import * as path from "path";

type SourceKey = "v1" | "v2" | "payment";

function getLogGroups(): { v1: string; v2: string; payment: string } {
  const v1 = process.env.CLOUDWATCH_LOG_GROUP_V1;
  const v2 = process.env.CLOUDWATCH_LOG_GROUP_V2;
  const payment = process.env.CLOUDWATCH_LOG_GROUP_PAYMENT;
  if (!v1 || !v2 || !payment) {
    throw new Error(
      "Faltan CLOUDWATCH_LOG_GROUP_V1, CLOUDWATCH_LOG_GROUP_V2 o CLOUDWATCH_LOG_GROUP_PAYMENT en .env.local"
    );
  }
  return { v1, v2, payment };
}

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const idx = trimmed.indexOf("=");
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          process.env[key] = val;
        }
      }
    }
  }
}

/** Día local México → rango UTC (00:00–23:59:59.999 México). */
function mexicoDayToUtcRange(
  year: number,
  month: number,
  day: number
): { startSec: number; endSec: number } {
  const startUtc = new Date(
    Date.UTC(year, month - 1, day, 6, 0, 0, 0)
  ).getTime();
  const endUtc = new Date(
    Date.UTC(year, month - 1, day + 1, 5, 59, 59, 999)
  ).getTime();
  return {
    startSec: Math.floor(startUtc / 1000),
    endSec: Math.floor(endUtc / 1000),
  };
}

function createClient(): CloudWatchLogsClient {
  return new CloudWatchLogsClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

/** Misma query que fetchCloudWatch: solo fields + filter. V2 sin filtro output!=null para incluir SPEI. */
const QUERY_RAW_V1_V2 =
  'fields @timestamp, @message | filter @message like /TaskStateExited/ and @message like /Preparar Datos/ | filter @message not like /"output":"null"/ | limit 10000';

const QUERY_RAW_V2 =
  'fields @timestamp, @message | filter @message like /TaskStateExited/ and @message like /Preparar Datos/ | limit 10000';

const QUERY_RAW_PAYMENT =
  'fields @timestamp, @message | filter @message like /PAGO VALIDADO/ | filter @message like /referencia/ | limit 10000';

interface Row {
  referencia: string;
  monto: number;
  source: SourceKey;
  /** Timestamp del log (UTC). */
  logTimestamp: string;
  /** Fecha de transacción del payload si existe (YYYY-MM-DD o ISO). */
  fechaTransaccion: string;
}

const FEB_START = "2026-02-01";
const FEB_END = "2026-02-22";

/** Timestamp UTC → YYYY-MM-DD en hora México (UTC-6). */
function timestampToMexicoDate(ts: string): string {
  if (!ts || !/^\d{4}/.test(ts)) return "";
  const normalized = ts.includes("T") || ts.endsWith("Z") ? ts : ts.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  const mexicoMs = date.getTime() - 6 * 60 * 60 * 1000;
  const m = new Date(mexicoMs);
  const y = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, "0");
  const d = String(m.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Fecha de transacción o timestamp → YYYY-MM-DD (para comparar con ventana Feb). */
function toImportDate(fechaTxn: string, logTs: string): string {
  if (fechaTxn && /^\d{4}-\d{2}-\d{2}/.test(fechaTxn.trim())) {
    const d = fechaTxn.trim().substring(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    return timestampToMexicoDate(fechaTxn) || d;
  }
  return timestampToMexicoDate(logTs);
}

/** Extrae referencia, monto y fechaTransaccion del @message (JSON). */
function parseMessageToRow(
  messageStr: string,
  source: SourceKey,
  logTimestamp: string
): Row | null {
  const refMatch =
    messageStr.match(/"referencia"\s*:\s*"(\d+)"/) ??
    messageStr.match(/\\"referencia\\"\s*:\s*\\"(\d+)\\"/);
  if (!refMatch?.[1]) return null;
  const referencia = refMatch[1].trim();
  let monto = 0;
  if (source === "payment") {
    const m =
      messageStr.match(/"total_pagar"\s*:\s*"([0-9.]+)"/) ??
      messageStr.match(/"total_pagar"\s*:\s*(\d+(?:\.\d+)?)/) ??
      messageStr.match(/total_pagar[^0-9]*(\d+(?:\.\d+)?)/);
    if (m?.[1]) monto = parseFloat(m[1]);
  } else {
    const m =
      messageStr.match(/"importeTxn"\s*:\s*"(\d+)"/) ??
      messageStr.match(/"importeTxn"\s*:\s*(\d+)/) ??
      messageStr.match(/importeTxn[^0-9]*(\d+)/);
    if (m?.[1]) monto = parseFloat(m[1]);
  }
  let fechaTransaccion = "";
  const ft =
    messageStr.match(/"fechaTransaccion"\s*:\s*"([^"]+)"/) ??
    messageStr.match(/\\"fechaTransaccion\\"\s*:\s*\\"([^"]+)\\"/);
  if (ft?.[1]) fechaTransaccion = ft[1].trim();
  return { referencia, monto, source, logTimestamp, fechaTransaccion };
}

async function runQueryRows(
  client: CloudWatchLogsClient,
  logGroupName: string,
  queryString: string,
  startTimeSec: number,
  endTimeSec: number,
  source: SourceKey
): Promise<Row[]> {
  const startRes = await client.send(
    new StartQueryCommand({
      logGroupName,
      startTime: startTimeSec,
      endTime: endTimeSec,
      queryString,
    })
  );
  if (!startRes.queryId) throw new Error("No queryId");

  let status: QueryStatus | undefined = QueryStatus.Running;
  let results: Array<Array<{ field?: string; value?: string }>> = [];
  let attempts = 0;

  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= 120) throw new Error("Query timeout (120s)");
    await new Promise((r) => setTimeout(r, 1000));
    const getRes = await client.send(
      new GetQueryResultsCommand({ queryId: startRes.queryId })
    );
    status = getRes.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      results = getRes.results || [];
      break;
    }
  }

  const rows: Row[] = [];
  for (const row of results) {
    const rec: Record<string, string> = {};
    for (const f of row) {
      if (f.field && f.value) rec[f.field] = f.value;
    }
    const msg = rec["@message"];
    const ts = rec["@timestamp"] ?? "";
    if (!msg) continue;
    const parsed = parseMessageToRow(msg, source, ts);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

/** Prioridad de dedup: menor número = mayor prioridad (igual que Convex). */
const DEDUP_ORDER: Record<SourceKey, number> = {
  payment: 0,
  v2: 1,
  v1: 2,
};

function deduplicate(rows: Row[]): Row[] {
  const byRef = new Map<string, Row>();
  for (const row of rows) {
    const existing = byRef.get(row.referencia);
    if (
      !existing ||
      DEDUP_ORDER[row.source] < DEDUP_ORDER[existing.source]
    ) {
      byRef.set(row.referencia, row);
    }
  }
  return Array.from(byRef.values());
}

async function main(): Promise<void> {
  loadEnv();

  const missing = ["v1", "v2", "payment"].filter(
    (k) => !process.env[`CLOUDWATCH_LOG_GROUP_${k.toUpperCase()}`]
  );
  if (missing.length) {
    console.error(
      "Faltan variables de entorno:",
      missing.map((k) => `CLOUDWATCH_LOG_GROUP_${k.toUpperCase()}`).join(", ")
    );
    process.exit(1);
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("Faltan AWS_ACCESS_KEY_ID o AWS_SECRET_ACCESS_KEY en .env.local");
    process.exit(1);
  }

  const LOG_GROUPS = getLogGroups();
  const client = createClient();
  const year = 2026;
  const month = 2;
  const dayStart = 1;
  const dayEnd = 22;

  const { startSec: startSecFull, endSec: endSecFull } = mexicoDayToUtcRange(
    year,
    month,
    dayStart
  );
  const endRange = mexicoDayToUtcRange(year, month, dayEnd);
  const startSecFullRange = startSecFull;
  const endSecFullRange = endRange.endSec;

  console.log(`Rango: Feb ${year} días ${dayStart}–${dayEnd} (hora México)`);
  console.log("Consultando por fuente (rango completo) y aplicando deduplicación (payment > v2 > v1)...\n");

  const allRows: Row[] = [];
  const sources: SourceKey[] = ["v1", "v2", "payment"];

  for (const source of sources) {
    const logGroup = LOG_GROUPS[source];
    const query =
      source === "payment"
        ? QUERY_RAW_PAYMENT
        : source === "v2"
          ? QUERY_RAW_V2
          : QUERY_RAW_V1_V2;
    process.stdout.write(`Consultando ${source}... `);
    try {
      const rows = await runQueryRows(
        client,
        logGroup,
        query,
        startSecFullRange,
        endSecFullRange,
        source
      );
      allRows.push(...rows);
      console.log(`${rows.length} filas`);
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      console.error("Error:", e instanceof Error ? e.message : e);
    }
  }

  const hitLimit = allRows.length > 0 && sources.some((s) => {
    const n = allRows.filter((r) => r.source === s).length;
    return n >= 10000;
  });
  if (hitLimit) {
    console.log("\nUna fuente alcanzó el límite de 10k. Consultando día a día para conteo completo...\n");
    allRows.length = 0;
    for (let day = dayStart; day <= dayEnd; day++) {
      const { startSec, endSec } = mexicoDayToUtcRange(year, month, day);
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      process.stdout.write(`${dateStr} `);
      for (const source of sources) {
        const logGroup = LOG_GROUPS[source];
        const query =
      source === "payment"
        ? QUERY_RAW_PAYMENT
        : source === "v2"
          ? QUERY_RAW_V2
          : QUERY_RAW_V1_V2;
        try {
          const rows = await runQueryRows(client, logGroup, query, startSec, endSec, source);
          allRows.push(...rows);
          await new Promise((r) => setTimeout(r, 600));
        } catch (e) {
          console.error(`\nError ${source} ${dateStr}:`, e instanceof Error ? e.message : e);
        }
      }
      console.log(`acum: ${allRows.length}`);
    }
  }

  if (allRows.length === 0) {
    console.log("\nNo se obtuvieron filas (límite 10k por fuente; V2 puede tener más). Ejecutando día a día...\n");
    for (let day = dayStart; day <= dayEnd; day++) {
      const { startSec, endSec } = mexicoDayToUtcRange(year, month, day);
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      process.stdout.write(`${dateStr} ... `);
      for (const source of sources) {
        const logGroup = LOG_GROUPS[source];
        const query =
      source === "payment"
        ? QUERY_RAW_PAYMENT
        : source === "v2"
          ? QUERY_RAW_V2
          : QUERY_RAW_V1_V2;
        try {
          const rows = await runQueryRows(
            client,
            logGroup,
            query,
            startSec,
            endSec,
            source
          );
          allRows.push(...rows);
          await new Promise((r) => setTimeout(r, 800));
        } catch (e) {
          console.error(`\nError ${source} ${dateStr}:`, e instanceof Error ? e.message : e);
        }
      }
      console.log(`acum: ${allRows.length} filas`);
    }
  }

  const totalRaw = allRows.length;
  const dedupedAll = deduplicate(allRows);

  // Criterio A: evento con timestamp del LOG en Feb 1–22 (ventana de CloudWatch)
  const byLogWindow = dedupedAll.filter((r) => {
    const d = timestampToMexicoDate(r.logTimestamp);
    return d >= FEB_START && d <= FEB_END;
  });
  const dedupByLog = deduplicate(byLogWindow);
  const countByLog = dedupByLog.length;
  const sumByLog = dedupByLog.reduce((s, r) => s + r.monto, 0);

  // Criterio B: importDate (fechaTransaccion o fallback log) en Feb 1–22 = mismo criterio que Convex (importMonth 2026-02)
  const byTxnDate = dedupedAll.filter((r) => {
    const d = toImportDate(r.fechaTransaccion, r.logTimestamp);
    return d >= FEB_START && d <= FEB_END;
  });
  const dedupByTxn = deduplicate(byTxnDate);
  const countByTxn = dedupByTxn.length;
  const sumByTxn = dedupByTxn.reduce((s, r) => s + r.monto, 0);

  const withFechaTxn = dedupedAll.filter((r) => r.fechaTransaccion && /^\d{4}/.test(r.fechaTransaccion)).length;
  const withoutFechaTxn = dedupedAll.length - withFechaTxn;

  console.log("");
  console.log("--- Resultado con deduplicación (payment > v2 > v1) ---");
  console.log("Eventos totales (3 fuentes, sin dedup):", totalRaw);
  console.log("");
  console.log("Criterio A – Por TIMESTAMP DEL LOG (evento registrado en CloudWatch en Feb 1–22):");
  console.log("  Referencias únicas:", countByLog);
  console.log("  Suma montos:", sumByLog.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log("");
  console.log("Criterio B – Por FECHA DE TRANSACCIÓN (importDate en Feb 1–22, igual que Convex importMonth):");
  console.log("  Referencias únicas:", countByTxn);
  console.log("  Suma montos:", sumByTxn.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log("");
  console.log("Diagnóstico: de los eventos deduped,", withFechaTxn, "tienen fechaTransaccion en payload;", withoutFechaTxn, "usan timestamp del log como importDate.");
  console.log("");
  console.log("Convex muestra 2026-02 por importMonth (mismo criterio B). Si 8,816 ≠", countByTxn, "posibles causas:");
  console.log("  - No se sincronizaron todos los días Feb 1–22 en Convex.");
  console.log("  - monthStats calculado con datos parciales o anterior a una recarga.");
  console.log("  - Diferencia de criterio en fechaTransaccion (parse distinto).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
