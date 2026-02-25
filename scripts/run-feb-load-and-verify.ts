/**
 * Ejecuta la carga CloudWatch para Feb 1–22 2026 (un día por vez) y luego
 * corre la verificación de referencias sentinela.
 *
 * Uso: pnpm exec tsx scripts/run-feb-load-and-verify.ts
 * Requiere: Convex desplegado (npx convex dev o deploy) y env AWS/CloudWatch en Convex.
 */

import { execSync } from "child_process";

const START = "2026-02-01";
const END = "2026-02-22";

function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const startMs = new Date(sy, sm - 1, sd).getTime();
  const endMs = new Date(ey, em - 1, ed).getTime();
  for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function main(): void {
  const dates = datesInRange(START, END);
  console.log(`Carga CloudWatch Feb 2026: ${dates.length} días (${START} → ${END})\n`);

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    process.stdout.write(`[${i + 1}/${dates.length}] ${date} `);
    try {
      execSync(
        `npx convex run actions:fetchAndIngestForDate '{"date":"${date}","skipMonthStatsUpdate":true}'`,
        { stdio: "pipe", encoding: "utf-8", cwd: process.cwd() }
      );
      console.log("OK");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("ERROR:", msg.slice(0, 120));
    }
  }

  console.log("\nRegenerando monthStats para 2026-02...");
  try {
    execSync(
      `npx convex run actions:recreateMonthStatsFromPaymentRecords '{"month":"2026-02"}'`,
      { stdio: "inherit", cwd: process.cwd() }
    );
  } catch (e) {
    console.error("Error al regenerar monthStats:", e);
  }

  console.log("\n--- Verificación referencias sentinela ---");
  try {
    execSync("pnpm exec tsx scripts/verify-sentinel-after-sync.ts", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  } catch (e) {
    process.exitCode = 1;
  }
}

main();
