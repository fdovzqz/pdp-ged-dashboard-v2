/**
 * Diagnóstico de alineación CloudWatch vs Convex para un mes.
 * Muestra monthStats (2026-02) y su desglose por día para comparar con el script de CloudWatch.
 *
 * Uso: pnpm exec tsx scripts/diagnostico-feb-convex.ts
 * Requiere .env.local con CONVEX_URL o NEXT_PUBLIC_CONVEX_URL.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as fs from "fs";
import * as path from "path";

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
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL en .env.local");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  const month = "2026-02";

  const stats = (await client.query(api.cloudwatchQueries.getMonthStats, {
    month,
  })) as {
    kpis: { totalPagos: number; montoTotal: number; referenciasUnicas?: number };
    ingestionStatus: { totalRecords: number; daysWithData: number; byDate: Array<{ date: string; count: number }> };
  } | null;

  if (!stats) {
    console.log("No hay monthStats para", month);
    return;
  }

  console.log("--- Convex monthStats", month, "---");
  console.log("totalRecords (ingestionStatus):", stats.ingestionStatus.totalRecords);
  console.log("totalPagos (kpis):", stats.kpis.totalPagos);
  console.log("montoTotal:", stats.kpis.montoTotal?.toLocaleString("es-MX", { minimumFractionDigits: 2 }));
  console.log("días con datos:", stats.ingestionStatus.daysWithData);
  console.log("");
  console.log("Desglose por día (byDate):");
  const byDate = stats.ingestionStatus.byDate ?? [];
  byDate.sort((a, b) => a.date.localeCompare(b.date));
  let sum = 0;
  for (const { date, count } of byDate) {
    sum += count;
    console.log("  ", date, count);
  }
  console.log("");
  console.log("Suma de byDate:", sum, "(debe coincidir con totalRecords)");
  console.log("");
  console.log("Comparación con CloudWatch (script cloudwatch-feb-2026-stats.ts):");
  console.log("  - Criterio B (fecha transacción Feb 1–22) dio ~12,775 referencias únicas.");
  console.log("  - Convex tiene 22 días con datos y total 8,816.");
  console.log("");
  console.log("Diferencia 12,775 - 8,816 = 3,959. Causa más probable:");
  console.log("  Convex guarda UNA sola fila por referencia (global). Si la misma referencia");
  console.log("  aparece en logs de febrero y de otro mes (ej. marzo o enero), al sincronizar");
  console.log("  ese otro mes se reemplaza la fila y la referencia pasa a importMonth de ese mes.");
  console.log("  Por tanto: 8,816 = referencias que HOY tienen importMonth 2026-02 (last-write-wins).");
  console.log("  12,775 = referencias que tienen AL MENOS UN evento en CloudWatch con fecha en Feb.");
  console.log("  Para alinear: ejecutar recarga completa de Feb (o solo Feb) y no sobrescribir después");
  console.log("  con otros meses, o definir si el número de referencia es por 'última asignación' (Convex)");
  console.log("  o por 'algún evento en el mes' (CloudWatch criterio B).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
