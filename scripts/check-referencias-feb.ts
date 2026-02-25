/**
 * Busca referencias en Convex (paymentRecords) y muestra si están en Feb 2026.
 * Uso: pnpm exec tsx scripts/check-referencias-feb.ts
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

const REFERENCIAS = [
  "202600002323148754268",
  "202600002968248834274",
  "202600002823548839291",
  "202600002547848836231",
  "202600002531048837213",
];

async function main(): Promise<void> {
  loadEnv();
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL en .env.local");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  const month = "2026-02";

  console.log("Buscando referencias en Convex (paymentRecords)...\n");

  for (const ref of REFERENCIAS) {
    const docs = (await client.query(api.cloudwatchQueries.searchByReferencia, {
      referencia: ref,
    })) as Array<{
      _id: string;
      referencia: string;
      importMonth: string;
      importDate?: string;
      logSource: string;
      monto: number;
      timestamp?: string;
    }>;

    const inFeb = docs.some((d) => d.importMonth === month);
    console.log(ref);
    if (docs.length === 0) {
      console.log("  No encontrada en paymentRecords.");
    } else {
      for (const d of docs) {
        console.log(
          "  importMonth:",
          d.importMonth,
          "| importDate:",
          d.importDate ?? "-",
          "| logSource:",
          d.logSource,
          "| monto:",
          d.monto
        );
      }
      console.log("  En Febrero 2026:", inFeb ? "Sí" : "No");
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
