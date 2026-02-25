/**
 * Verifica el estado de los datos cargados hasta una fecha (por defecto 2025-12-31).
 * Usa getAllMonthsStatus para ver qué meses tienen datos.
 *
 * Uso: npx tsx scripts/check-data-status.ts [fecha-límite YYYY-MM-DD]
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

async function main(): Promise<void> {
  const limitDate = process.argv[2] ?? "2025-12-31";
  const [limitYear, limitMonth] = limitDate.split("-").map(Number);

  loadEnv();
  const convexUrl =
    process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error(
      "CONVEX_URL o NEXT_PUBLIC_CONVEX_URL requerido en .env.local"
    );
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);

  const allStatus = (await client.query(api.cloudwatchQueries.getAllMonthsStatus, {})) as Array<{
    month: string;
    totalRecords: number;
    daysWithData: number;
    lastUpdated: number;
  }>;

  const statusByMonth = new Map(allStatus.map((s) => [s.month, s]));

  const expectedMonths = generateMonthRange("2024-01", "2025-12");
  const missing: string[] = [];
  const incomplete: Array<{ month: string; daysWithData: number; expected: number }> = [];

  for (const month of expectedMonths) {
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const status = statusByMonth.get(month);

    if (!status) {
      missing.push(month);
      continue;
    }

    if (status.totalRecords === 0) {
      missing.push(month);
      continue;
    }

    if (status.daysWithData < daysInMonth) {
      incomplete.push({
        month,
        daysWithData: status.daysWithData,
        expected: daysInMonth,
      });
    }
  }

  console.log("\n=== Verificación de datos hasta", limitDate, "===\n");
  console.log("Meses esperados (2024-01 a 2025-12):", expectedMonths.length);
  console.log("Meses con datos:", allStatus.filter((s) => s.totalRecords > 0).length);
  console.log("");

  if (missing.length > 0) {
    console.log("⚠️  MESES SIN DATOS (" + missing.length + "):");
    missing.forEach((m) => console.log("   -", m));
    console.log("");
  }

  if (incomplete.length > 0) {
    console.log("⚠️  MESES INCOMPLETOS (días con datos < días del mes):");
    incomplete.forEach(({ month, daysWithData, expected }) =>
      console.log(`   - ${month}: ${daysWithData}/${expected} días`)
    );
    console.log("");
  }

  if (missing.length === 0 && incomplete.length === 0) {
    console.log("✓ Todos los datos están cargados correctamente hasta 2025-12.");
  } else {
    console.log(
      "Resumen:",
      missing.length,
      "meses sin datos,",
      incomplete.length,
      "meses incompletos."
    );
  }

  console.log("\nDetalle por mes con datos:");
  for (const s of allStatus.sort((a, b) => a.month.localeCompare(b.month))) {
    if (s.totalRecords > 0) {
      const [y, m] = s.month.split("-").map(Number);
      const expectedDays = new Date(y, m, 0).getDate();
      const statusStr =
        s.daysWithData >= expectedDays ? "✓" : `⚠ ${s.daysWithData}/${expectedDays}`;
      console.log(
        `  ${s.month}: ${s.totalRecords.toLocaleString()} registros, ${s.daysWithData} días ${statusStr}`
      );
    }
  }
  console.log("");
}

main().catch(console.error);
