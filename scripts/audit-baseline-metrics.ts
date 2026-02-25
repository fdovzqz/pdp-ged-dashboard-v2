/**
 * Baseline de auditoría: métricas A, B y C para 2026-01-01..2026-02-22.
 * A) Eventos por timestamp de log (CloudWatch, por día y fuente).
 * B) Referencias únicas por fecha de transacción/importDate (CloudWatch parseado + dedup).
 * C) Convex importMonth actual (monthStats por mes y byDate).
 *
 * Escribe snapshot en docs/audit/audit-baseline-YYYYMMDD-HHmmss.json
 *
 * Uso:
 *   pnpm exec tsx scripts/audit-baseline-metrics.ts           # Convex + CloudWatch (lento)
 *   pnpm exec tsx scripts/audit-baseline-metrics.ts --convex-only  # Solo C
 */

import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as fs from "fs";
import * as path from "path";

type SourceKey = "v1" | "v2" | "payment";

const RANGE_START = "2026-01-01";
const RANGE_END = "2026-02-22";

function getLogGroups(): { v1: string; v2: string; payment: string } {
  const v1 = process.env.CLOUDWATCH_LOG_GROUP_V1;
  const v2 = process.env.CLOUDWATCH_LOG_GROUP_V2;
  const payment = process.env.CLOUDWATCH_LOG_GROUP_PAYMENT;
  if (!v1 || !v2 || !payment) {
    throw new Error(
      "Faltan CLOUDWATCH_LOG_GROUP_* en .env.local"
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

function createCwClient(): CloudWatchLogsClient {
  return new CloudWatchLogsClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

const QUERY_RAW_V2 =
  'fields @timestamp, @message | filter @message like /TaskStateExited/ and @message like /Preparar Datos/ | limit 10000';
const QUERY_RAW_V1 =
  'fields @timestamp, @message | filter @message like /TaskStateExited/ and @message like /Preparar Datos/ | filter @message not like /"output":"null"/ | limit 10000';
const QUERY_RAW_PAYMENT =
  'fields @timestamp, @message | filter @message like /PAGO VALIDADO/ | filter @message like /referencia/ | limit 10000';

interface Row {
  referencia: string;
  monto: number;
  source: SourceKey;
  logTimestamp: string;
  fechaTransaccion: string;
}

function timestampToMexicoDate(ts: string): string {
  if (!ts || !/^\d{4}/.test(ts)) return "";
  const normalized = ts.includes("T") || ts.endsWith("Z") ? ts : ts.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  const mexicoMs = date.getTime() - 6 * 60 * 60 * 1000;
  const m = new Date(mexicoMs);
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}-${String(m.getUTCDate()).padStart(2, "0")}`;
}

function toImportDate(fechaTxn: string, logTs: string): string {
  if (fechaTxn && /^\d{4}-\d{2}-\d{2}/.test(fechaTxn.trim())) {
    const d = fechaTxn.trim().substring(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    return timestampToMexicoDate(fechaTxn) || d;
  }
  return timestampToMexicoDate(logTs);
}

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

const DEDUP_ORDER: Record<SourceKey, number> = {
  payment: 0,
  v2: 1,
  v1: 2,
};

function deduplicate(rows: Row[]): Row[] {
  const byRef = new Map<string, Row>();
  for (const row of rows) {
    const existing = byRef.get(row.referencia);
    if (!existing || DEDUP_ORDER[row.source] < DEDUP_ORDER[existing.source]) {
      byRef.set(row.referencia, row);
    }
  }
  return Array.from(byRef.values());
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
    if (attempts >= 120) throw new Error("Query timeout");
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

function parseRange(): { start: string; end: string; days: Array<{ y: number; m: number; d: number }> } {
  const [sy, sm, sd] = RANGE_START.split("-").map(Number);
  const [ey, em, ed] = RANGE_END.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const days: Array<{ y: number; m: number; d: number }> = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({
      y: d.getFullYear(),
      m: d.getMonth() + 1,
      d: d.getDate(),
    });
  }
  return { start: RANGE_START, end: RANGE_END, days };
}

interface BaselineSnapshot {
  generatedAt: string;
  range: { start: string; end: string };
  metricA: {
    description: string;
    byDay: Record<string, { v1: number; v2: number; payment: number; total: number }>;
    totalBySource: { v1: number; v2: number; payment: number };
    totalEvents: number;
  };
  metricB: {
    description: string;
    byDay: Record<string, number>;
    totalUniqueRefsInRange: number;
    sumMonto: number;
  };
  metricC: {
    description: string;
    months: Record<
      string,
      { totalRecords: number; daysWithData: number; byDate: Array<{ date: string; count: number }> }
    >;
  };
}

async function fetchConvexBaseline(convexUrl: string): Promise<BaselineSnapshot["metricC"]> {
  const client = new ConvexHttpClient(convexUrl);
  const months: BaselineSnapshot["metricC"]["months"] = {};
  for (const month of ["2026-01", "2026-02"]) {
    const stats = (await client.query(api.cloudwatchQueries.getMonthStats, {
      month,
    })) as {
      ingestionStatus: {
        totalRecords: number;
        daysWithData: number;
        byDate: Array<{ date: string; count: number }>;
      };
    } | null;
    if (!stats) {
      months[month] = { totalRecords: 0, daysWithData: 0, byDate: [] };
      continue;
    }
    months[month] = {
      totalRecords: stats.ingestionStatus.totalRecords,
      daysWithData: stats.ingestionStatus.daysWithData,
      byDate: stats.ingestionStatus.byDate ?? [],
    };
  }
  return { description: "Convex importMonth actual (monthStats)", months };
}

async function main(): Promise<void> {
  loadEnv();
  const convexOnly = process.argv.includes("--convex-only");
  const convexUrl =
    process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL en .env.local");
    process.exit(1);
  }

  const snapshot: BaselineSnapshot = {
    generatedAt: new Date().toISOString(),
    range: { start: RANGE_START, end: RANGE_END },
    metricA: {
      description: "Eventos por timestamp de log (CloudWatch, por día y fuente)",
      byDay: {},
      totalBySource: { v1: 0, v2: 0, payment: 0 },
      totalEvents: 0,
    },
    metricB: {
      description: "Referencias únicas por fecha transacción/importDate (CloudWatch parseado + dedup)",
      byDay: {},
      totalUniqueRefsInRange: 0,
      sumMonto: 0,
    },
    metricC: await fetchConvexBaseline(convexUrl),
  };

  if (convexOnly) {
    console.log("--- Solo Convex (C) ---");
    console.log(JSON.stringify(snapshot.metricC, null, 2));
    writeSnapshot(snapshot);
    return;
  }

  console.log("--- Baseline A/B/C para", RANGE_START, "..", RANGE_END, "---");
  const { days } = parseRange();
  const LOG_GROUPS = getLogGroups();
  const client = createCwClient();
  const sources: SourceKey[] = ["v1", "v2", "payment"];
  const allRows: Row[] = [];
  const byDaySource: Record<string, { v1: number; v2: number; payment: number }> = {};

  for (let i = 0; i < days.length; i++) {
    const { y, m, d } = days[i];
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const { startSec, endSec } = mexicoDayToUtcRange(y, m, d);
    byDaySource[dateStr] = { v1: 0, v2: 0, payment: 0 };
    process.stdout.write(`[${i + 1}/${days.length}] ${dateStr} `);
    for (const source of sources) {
      const logGroup = LOG_GROUPS[source];
      const query =
        source === "payment"
          ? QUERY_RAW_PAYMENT
          : source === "v2"
            ? QUERY_RAW_V2
            : QUERY_RAW_V1;
      try {
        const rows = await runQueryRows(client, logGroup, query, startSec, endSec, source);
        allRows.push(...rows);
        byDaySource[dateStr][source] = rows.length;
        await new Promise((r) => setTimeout(r, 600));
      } catch (e) {
        console.error(`\nError ${source} ${dateStr}:`, e instanceof Error ? e.message : e);
      }
    }
    console.log(
      `v1=${byDaySource[dateStr].v1} v2=${byDaySource[dateStr].v2} pay=${byDaySource[dateStr].payment}`
    );
  }

  for (const [dateStr, counts] of Object.entries(byDaySource)) {
    snapshot.metricA.byDay[dateStr] = {
      ...counts,
      total: counts.v1 + counts.v2 + counts.payment,
    };
    snapshot.metricA.totalBySource.v1 += counts.v1;
    snapshot.metricA.totalBySource.v2 += counts.v2;
    snapshot.metricA.totalBySource.payment += counts.payment;
  }
  snapshot.metricA.totalEvents =
    snapshot.metricA.totalBySource.v1 +
    snapshot.metricA.totalBySource.v2 +
    snapshot.metricA.totalBySource.payment;

  const deduped = deduplicate(allRows);
  const inRange = deduped.filter((r) => {
    const d = toImportDate(r.fechaTransaccion, r.logTimestamp);
    return d >= RANGE_START && d <= RANGE_END;
  });
  const byDayCount: Record<string, number> = {};
  for (const r of inRange) {
    const d = toImportDate(r.fechaTransaccion, r.logTimestamp);
    byDayCount[d] = (byDayCount[d] ?? 0) + 1;
  }
  snapshot.metricB.byDay = byDayCount;
  snapshot.metricB.totalUniqueRefsInRange = inRange.length;
  snapshot.metricB.sumMonto = inRange.reduce((s, r) => s + r.monto, 0);

  writeSnapshot(snapshot);

  console.log("\n--- Resumen ---");
  console.log("A) Total eventos (raw):", snapshot.metricA.totalEvents);
  console.log("B) Ref únicas por importDate en rango:", snapshot.metricB.totalUniqueRefsInRange);
  console.log("C) Convex 2026-01:", snapshot.metricC.months["2026-01"]?.totalRecords ?? 0);
  console.log("C) Convex 2026-02:", snapshot.metricC.months["2026-02"]?.totalRecords ?? 0);
}

function writeSnapshot(snapshot: BaselineSnapshot): void {
  const auditDir = path.resolve(process.cwd(), "docs", "audit");
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  const filename = path.join(
    auditDir,
    `audit-baseline-${snapshot.generatedAt.slice(0, 10)}-${Date.now()}.json`
  );
  fs.writeFileSync(filename, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log("Snapshot guardado:", filename);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
