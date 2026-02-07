/**
 * Lee archivos JSON de data/, parsea los 3 formatos de log (v1, v2, payment),
 * normaliza y ingesta a Convex.
 *
 * Requiere: CONVEX_URL en env
 *
 * Uso: CONVEX_URL=https://xxx.convex.cloud npx tsx scripts/ingest-to-convex.ts [date]
 *      Sin argumentos usa 2026-01-15 por defecto.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as fs from "fs";
import * as path from "path";
import {
  parseV1V2Logs,
  parsePaymentLogs,
  type NormalizedPaymentRecord,
} from "./lib/parsers";

const BATCH_SIZE = 100;
const DEFAULT_DATE = "2026-01-15";

function loadEnvFromDashboard(): void {
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

async function main(): Promise<void> {
  const targetDate = process.argv[2] ?? DEFAULT_DATE;
  const dataDir = path.resolve(process.cwd(), "data");

  loadEnvFromDashboard();
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error(
      "CONVEX_URL requerido. Ej: CONVEX_URL=https://xxx.convex.cloud npx tsx scripts/ingest-to-convex.ts"
    );
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);

  const allRecords: NormalizedPaymentRecord[] = [];
  const files = [
    { file: `v1-${targetDate}.json`, source: "v1" as const },
    { file: `v2-${targetDate}.json`, source: "v2" as const },
    { file: `payment-${targetDate}.json`, source: "payment" as const },
  ];

  for (const { file, source } of files) {
    const filepath = path.join(dataDir, file);
    if (!fs.existsSync(filepath)) {
      console.warn(`[SKIP] ${file} no existe`);
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(filepath, "utf-8")) as Array<
      Record<string, string>
    >;

    if (source === "payment") {
      allRecords.push(...parsePaymentLogs(raw));
    } else {
      allRecords.push(...parseV1V2Logs(raw, source));
    }
  }

  const byRef = new Map<string, NormalizedPaymentRecord>();
  const order = { payment: 0, v2: 1, v1: 2 };
  for (const r of allRecords) {
    const existing = byRef.get(r.referencia);
    if (
      !existing ||
      (order[r.logSource] >= order[existing.logSource] && r.monto > 0)
    ) {
      byRef.set(r.referencia, r);
    }
  }
  const uniqueRecords = [...byRef.values()];

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

  console.log(`Done. inserted=${totalInserted} skipped=${totalSkipped}`);
}

main().catch(console.error);
