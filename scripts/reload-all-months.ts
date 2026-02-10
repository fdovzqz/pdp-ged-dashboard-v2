#!/usr/bin/env tsx
/**
 * Re-sincroniza todos los meses con la nueva query (TaskStateExited, output != null).
 * Ejecutar después del fix de extracción para recargar datos correctos.
 *
 * Uso: npx tsx scripts/reload-all-months.ts [YYYY-MM] [YYYY-MM]
 * Ejemplo: npx tsx scripts/reload-all-months.ts 2024-01 2026-02
 * Sin args: recarga 2024-01 hasta 2026-02
 */

import { execSync } from "child_process";

const DAYS_PER_MONTH: Record<number, number> = {
  1: 31,
  2: 28,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_PER_MONTH[month] ?? 31;
}

function* monthRange(start: string, end: string): Generator<string> {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${String(m).padStart(2, "0")}`;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
}

const startArg = process.argv[2] ?? "2024-01";
const endArg = process.argv[3] ?? "2026-02";

console.log(`Re-sincronizando de ${startArg} a ${endArg}...`);

for (const month of monthRange(startArg, endArg)) {
  const [year, mon] = month.split("-").map(Number);
  const days = getDaysInMonth(year, mon);
  console.log(`\n=== ${month} (${days} días) ===`);

  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    try {
      execSync(
        `npx convex run actions:fetchAndIngestForDate '{"date":"${date}"}'`,
        { stdio: "pipe", encoding: "utf-8" }
      );
      process.stdout.write(".");
    } catch (e) {
      console.error(`\nError ${date}:`, (e as Error).message);
    }
  }

  console.log(`\nRegenerando stats para ${month}...`);
  execSync(
    `npx convex run actions:recreateMonthStatsFromPaymentRecords '{"month":"${month}"}'`,
    { stdio: "inherit" }
  );
  execSync(
    `npx convex run januaryETL:buildJanuaryAggregates '{"months":["${month}"]}'`,
    { stdio: "pipe", encoding: "utf-8" }
  );
}

console.log("\nRe-sincronización completada.");
