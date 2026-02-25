/**
 * Verificación post-sync: confirma que las 5 referencias sentinela (SPEI) están en Convex
 * con importMonth 2026-02. Para usar tras ejecutar "Carga por rango" (ej. Ene 1 2026 - Feb 22 2026).
 *
 * Exit 0: todas encontradas en Feb 2026.
 * Exit 1: alguna falta o no está en Feb 2026.
 *
 * Uso: pnpm exec tsx scripts/verify-sentinel-after-sync.ts
 * Requiere .env.local con CONVEX_URL o NEXT_PUBLIC_CONVEX_URL.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as fs from "fs";
import * as path from "path";

const SENTINEL_REFERENCIAS = [
  "202600002323148754268",
  "202600002968248834274",
  "202600002823548839291",
  "202600002547848836231",
  "202600002531048837213",
];

const TARGET_MONTH = "2026-02";

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
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL en .env.local");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  const results: Array<{ ref: string; found: boolean; importMonth: string | null }> = [];

  for (const ref of SENTINEL_REFERENCIAS) {
    const docs = (await client.query(api.cloudwatchQueries.searchByReferencia, {
      referencia: ref,
    })) as Array<{ importMonth: string }>;
    const found = docs.length > 0;
    const importMonth = found ? docs[0].importMonth : null;
    results.push({ ref, found, importMonth });
  }

  const allOk = results.every(
    (r) => r.found && r.importMonth === TARGET_MONTH
  );

  console.log("Verificación referencias sentinela (post-sync CloudWatch)\n");
  for (const r of results) {
    const status = r.found && r.importMonth === TARGET_MONTH ? "OK" : r.found ? `OK (importMonth=${r.importMonth})` : "FALTA";
    console.log(`${r.ref} ${status}`);
  }
  console.log("");
  if (allOk) {
    console.log("Todas las referencias sentinela están en Convex con importMonth", TARGET_MONTH);
    process.exit(0);
  }
  const missing = results.filter((r) => !r.found || r.importMonth !== TARGET_MONTH);
  console.error(`${missing.length} referencia(s) faltante(s) o con otro importMonth. Re-ejecuta Carga por rango (Feb 2026) y el parser con fallback V2/SPEI.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
