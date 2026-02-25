/**
 * Traza referencias sentinela (5 SPEI y opcionales) en cada etapa: CloudWatch → parse → dedup → Convex.
 * Genera árbol de causalidad por referencia para el plan de auditoría.
 *
 * Uso: pnpm exec tsx scripts/trace-sentinel-referencias.ts
 * Requiere .env.local (AWS_*, CLOUDWATCH_LOG_GROUP_*, CONVEX_URL).
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

const SENTINEL_REFERENCIAS = [
  "202600002323148754268",
  "202600002968248834274",
  "202600002823548839291",
  "202600002547848836231",
  "202600002531048837213",
];

const REF_PATTERN = SENTINEL_REFERENCIAS.join("|");
const FEB_START = "2026-02-01";
const FEB_END = "2026-02-22";

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

function getLogGroups(): { v1: string; v2: string; payment: string } {
  const v1 = process.env.CLOUDWATCH_LOG_GROUP_V1;
  const v2 = process.env.CLOUDWATCH_LOG_GROUP_V2;
  const payment = process.env.CLOUDWATCH_LOG_GROUP_PAYMENT;
  if (!v1 || !v2 || !payment) throw new Error("Faltan CLOUDWATCH_LOG_GROUP_* en .env.local");
  return { v1, v2, payment };
}

function mexicoDayToUtcRange(
  year: number,
  month: number,
  day: number
): { startSec: number; endSec: number } {
  const startUtc = new Date(Date.UTC(year, month - 1, day, 6, 0, 0, 0)).getTime();
  const endUtc = new Date(Date.UTC(year, month - 1, day + 1, 5, 59, 59, 999)).getTime();
  return {
    startSec: Math.floor(startUtc / 1000),
    endSec: Math.floor(endUtc / 1000),
  };
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

interface Row {
  referencia: string;
  monto: number;
  source: SourceKey;
  logTimestamp: string;
  fechaTransaccion: string;
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

const DEDUP_ORDER: Record<SourceKey, number> = { payment: 0, v2: 1, v1: 2 };

async function runQueryFiltered(
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
    if (attempts >= 60) throw new Error("Query timeout");
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
    if (parsed && SENTINEL_REFERENCIAS.includes(parsed.referencia)) rows.push(parsed);
  }
  return rows;
}

interface TraceResult {
  referencia: string;
  cloudwatch: {
    found: boolean;
    sources: SourceKey[];
    bySource: Record<SourceKey, { count: number; importDate: string; parseOk: boolean }>;
    dedupWinner: SourceKey | null;
    importDateFromWinner: string;
  };
  convex: {
    found: boolean;
    importMonth: string | null;
    importDate: string | null;
    logSource: string | null;
  };
  conclusion: string;
}

async function main(): Promise<void> {
  loadEnv();
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL en .env.local");
    process.exit(1);
  }
  const LOG_GROUPS = getLogGroups();
  const cwClient = new CloudWatchLogsClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const convexClient = new ConvexHttpClient(convexUrl);

  const [y, mo, dStart] = [2026, 2, 1];
  const dEnd = 22;
  const { startSec } = mexicoDayToUtcRange(y, mo, dStart);
  const { endSec: endSecFull } = mexicoDayToUtcRange(y, mo, dEnd);

  const queryV2 = `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message like /${REF_PATTERN}/
| limit 100`;
  const queryV1 = `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| filter @message like /${REF_PATTERN}/
| limit 100`;
  const queryPayment = `fields @timestamp, @message
| filter @message like /PAGO VALIDADO/ and @message like /referencia/
| filter @message like /${REF_PATTERN}/
| limit 100`;

  console.log("--- Trazabilidad referencias sentinela (CloudWatch → parse → dedup → Convex) ---\n");

  const allRows: Row[] = [];
  try {
    allRows.push(
      ...(await runQueryFiltered(cwClient, LOG_GROUPS.v1, queryV1, startSec, endSecFull, "v1"))
    );
    await new Promise((r) => setTimeout(r, 800));
    allRows.push(
      ...(await runQueryFiltered(cwClient, LOG_GROUPS.v2, queryV2, startSec, endSecFull, "v2"))
    );
    await new Promise((r) => setTimeout(r, 800));
    allRows.push(
      ...(await runQueryFiltered(cwClient, LOG_GROUPS.payment, queryPayment, startSec, endSecFull, "payment"))
    );
  } catch (e) {
    console.error("Error CloudWatch:", e);
  }

  const byRefCw = new Map<string, Row[]>();
  for (const r of allRows) {
    if (!SENTINEL_REFERENCIAS.includes(r.referencia)) continue;
    const list = byRefCw.get(r.referencia) ?? [];
    list.push(r);
    byRefCw.set(r.referencia, list);
  }

  const results: TraceResult[] = [];

  for (const referencia of SENTINEL_REFERENCIAS) {
    const cwRows = byRefCw.get(referencia) ?? [];
    const bySource: TraceResult["cloudwatch"]["bySource"] = {
      v1: { count: 0, importDate: "", parseOk: false },
      v2: { count: 0, importDate: "", parseOk: false },
      payment: { count: 0, importDate: "", parseOk: false },
    };
    const sourcesFound: SourceKey[] = [];
    let winner: Row | null = null;
    for (const r of cwRows) {
      bySource[r.source].count++;
      bySource[r.source].importDate = toImportDate(r.fechaTransaccion, r.logTimestamp);
      bySource[r.source].parseOk = true;
      if (!sourcesFound.includes(r.source)) sourcesFound.push(r.source);
      if (
        !winner ||
        DEDUP_ORDER[r.source] < DEDUP_ORDER[winner.source]
      ) {
        winner = r;
      }
    }

    const docs = (await convexClient.query(api.cloudwatchQueries.searchByReferencia, {
      referencia,
    })) as Array<{ importMonth: string; importDate?: string; logSource: string }>;
    const convexDoc = docs.length > 0 ? docs[0] : null;

    let conclusion: string;
    if (!cwRows.length) {
      conclusion = "No encontrada en CloudWatch (no aparece en logs del rango o filtro excluye).";
    } else if (!convexDoc) {
      conclusion = "En CloudWatch pero NO en Convex: pérdida en ingestión (parse/ventana/orden).";
    } else if (convexDoc.importMonth !== "2026-02") {
      conclusion = `En Convex con importMonth=${convexDoc.importMonth} (last-write-wins de otro mes).`;
    } else {
      conclusion = "Alineado: en CloudWatch y en Convex con importMonth 2026-02.";
    }

    results.push({
      referencia,
      cloudwatch: {
        found: cwRows.length > 0,
        sources: sourcesFound,
        bySource,
        dedupWinner: winner ? winner.source : null,
        importDateFromWinner: winner ? toImportDate(winner.fechaTransaccion, winner.logTimestamp) : "",
      },
      convex: {
        found: !!convexDoc,
        importMonth: convexDoc?.importMonth ?? null,
        importDate: convexDoc?.importDate ?? null,
        logSource: convexDoc?.logSource ?? null,
      },
      conclusion,
    });
  }

  for (const r of results) {
    console.log(r.referencia);
    console.log("  CloudWatch:", r.cloudwatch.found ? `sí (${r.cloudwatch.sources.join(", ")})` : "no");
    if (r.cloudwatch.dedupWinner) {
      console.log("  Dedup winner:", r.cloudwatch.dedupWinner, "| importDate:", r.cloudwatch.importDateFromWinner);
    }
    console.log("  Convex:", r.convex.found ? `importMonth=${r.convex.importMonth} importDate=${r.convex.importDate ?? "-"} logSource=${r.convex.logSource}` : "no");
    console.log("  Conclusión:", r.conclusion);
    console.log("");
  }

  const outPath = path.resolve(process.cwd(), "docs", "audit", "trace-sentinel-referencias.json");
  const auditDir = path.dirname(outPath);
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf-8");
  console.log("Resultados guardados en", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
