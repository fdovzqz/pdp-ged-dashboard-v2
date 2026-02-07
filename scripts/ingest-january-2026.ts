/**
 * Descarga logs de Enero 2026 de los 3 log groups (v1, v2, payment) en rangos de 5 días,
 * parsea, deduplica e ingesta a Convex.
 *
 * Requiere: CONVEX_URL, AWS credentials (dashboard/.env.local o env)
 *
 * Uso: CONVEX_URL=https://xxx.convex.cloud npx tsx scripts/ingest-january-2026.ts
 *
 * Ejecutar desde raíz del proyecto. Necesita node_modules con @aws-sdk y convex:
 *   npm install (en raíz) y opcionalmente NODE_PATH=./node_modules
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  loadEnvFromDashboard,
  downloadLogs,
  type LogVersion,
} from "./lib/download";
import { getMexicoDateRangeUtcMultiDay } from "./lib/mexicoDateRange";
import {
  parseV1V2Logs,
  parsePaymentLogs,
  type NormalizedPaymentRecord,
} from "./lib/parsers";

const BATCH_SIZE = 100;
const RANGES: Array<{ start: string; end: string }> = [
  { start: "2026-01-01", end: "2026-01-05" },
  { start: "2026-01-06", end: "2026-01-10" },
  { start: "2026-01-11", end: "2026-01-15" },
  { start: "2026-01-16", end: "2026-01-20" },
  { start: "2026-01-21", end: "2026-01-25" },
  { start: "2026-01-26", end: "2026-01-31" },
];

const VERSIONS: LogVersion[] = ["v1", "v2", "payment"];

async function main(): Promise<void> {
  loadEnvFromDashboard();

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL requerido");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  const byRef = new Map<string, NormalizedPaymentRecord>();
  const order = { payment: 0, v2: 1, v1: 2 };

  for (const range of RANGES) {
    const { startTimeSec: startTime, endTimeSec: endTime } =
      getMexicoDateRangeUtcMultiDay(range.start, range.end);

    for (const version of VERSIONS) {
      try {
        const rows = await downloadLogs(version, startTime, endTime);
        const parsed =
          version === "payment"
            ? parsePaymentLogs(rows)
            : parseV1V2Logs(rows, version);

        for (const r of parsed) {
          const existing = byRef.get(r.referencia);
          if (
            !existing ||
            (order[r.logSource] >= order[existing.logSource] && r.monto > 0)
          ) {
            byRef.set(r.referencia, r);
          }
        }
        console.log(
          `[${range.start}..${range.end}] [${version.toUpperCase()}] ${rows.length} rows -> ${parsed.length} parsed`
        );
      } catch (err) {
        console.warn(
          `[${range.start}..${range.end}] [${version.toUpperCase()}] Error:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  const uniqueRecords = [...byRef.values()];
  console.log(`\nTotal records únicos: ${uniqueRecords.length}`);

  let totalInserted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
    const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
    const recs = batch.map((r) => ({
      referencia: r.referencia,
      monto: r.monto,
      timestamp: r.timestamp,
      fechaTransaccion: r.fechaTransaccion,
      logSource: r.logSource,
      movimiento: r.movimiento,
      estatus: r.estatus,
      tramiteId: r.tramiteId,
      rawData: r.rawData,
      importMonth: r.importMonth,
    }));

    try {
      const result = (await client.mutation(api.mutations.ingestPaymentBatch, {
        records: recs,
      })) as { inserted: number; skipped: number };
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    } catch (err) {
      console.error("Batch error:", err);
    }
  }

  console.log(
    `\nDone. inserted=${totalInserted} skipped=${totalSkipped} total=${uniqueRecords.length}`
  );
}

main().catch(console.error);
