/**
 * Descarga logs raw del 15 de enero 2026 de los 3 log groups (v1, v2, payment).
 * Guarda en data/v1-2026-01-15.json, data/v2-2026-01-15.json, data/payment-2026-01-15.json
 *
 * Usa AWS SDK. Requiere dashboard/.env.local con credenciales AWS.
 *
 * Uso: npx tsx scripts/download-january-15-samples.ts
 *      (ejecutar desde raíz del proyecto)
 */

import * as fs from "fs";
import * as path from "path";
import { loadEnvFromDashboard, downloadLogs } from "./lib/download";
import { getMexicoDateRangeUtc } from "./lib/mexicoDateRange";

const TARGET_DATE = "2026-01-15";

async function main(): Promise<void> {
  loadEnvFromDashboard();

  const { startTimeSec: startTime, endTimeSec: endTime } =
    getMexicoDateRangeUtc(TARGET_DATE);

  const outputDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const versions = ["v1", "v2", "payment"] as const;
  console.log(`Downloading logs for ${TARGET_DATE} from ${versions.join(", ")}...`);

  for (const version of versions) {
    try {
      const results = await downloadLogs(version, startTime, endTime);
      const filename = path.join(outputDir, `${version}-${TARGET_DATE}.json`);
      fs.writeFileSync(filename, JSON.stringify(results, null, 2));
      console.log(`[${version.toUpperCase()}] Downloaded ${results.length} records -> ${filename}`);
    } catch (err) {
      console.error(`[${version.toUpperCase()}] Error:`, err instanceof Error ? err.message : String(err));
    }
  }
  console.log("\nDone.");
}

main();
