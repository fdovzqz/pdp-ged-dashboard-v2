/**
 * Regenera monthStats y dailyData para los meses con inconsistencias.
 * Ejecuta recreateMonthStatsFromPaymentRecords y buildCloudwatchAggregates.
 *
 * Uso: npx tsx scripts/regenerate-inconsistent-months.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as fs from "fs";
import * as path from "path";

const MONTHS_WITH_ISSUES = [
  "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06",
  "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12",
  "2025-01", "2025-02", "2025-04", "2025-05", "2025-06", "2025-07",
  "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01",
];

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

async function main(): Promise<void> {
  loadEnv();
  const convexUrl =
    process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL requerido en .env.local");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);

  console.log(`\n==> Regenerando ${MONTHS_WITH_ISSUES.length} meses con inconsistencias\n`);

  // 1. Regenerar monthStats para cada mes
  console.log("--- Paso 1: Regenerando monthStats ---\n");
  for (let i = 0; i < MONTHS_WITH_ISSUES.length; i++) {
    const month = MONTHS_WITH_ISSUES[i];
    process.stdout.write(`  [${i + 1}/${MONTHS_WITH_ISSUES.length}] ${month}... `);
    try {
      const result = (await client.action(
        api.actions.recreateMonthStatsFromPaymentRecords,
        { month }
      )) as { month: string; totalPagos: number; montoTotal: number };
      console.log(`OK (${result.totalPagos} pagos)`);
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Regenerar dailyData (buildCloudwatchAggregates) en lotes para evitar timeout
  const BATCH_SIZE = 8;
  const batches: string[][] = [];
  for (let i = 0; i < MONTHS_WITH_ISSUES.length; i += BATCH_SIZE) {
    batches.push(MONTHS_WITH_ISSUES.slice(i, i + BATCH_SIZE));
  }

  console.log("\n--- Paso 2: Regenerando dailyData (agregados) ---\n");
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`  Lote ${b + 1}/${batches.length}: ${batch.join(", ")}`);
    try {
      const result = (await client.action(
        api.aggregatesCloudwatchETL.buildCloudwatchAggregates,
        { months: batch }
      )) as { summary: Record<string, unknown>; totalRecords: number };
      console.log(`  OK - ${result.totalRecords} meses procesados\n`);
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  console.log("==> Regeneración completada.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
