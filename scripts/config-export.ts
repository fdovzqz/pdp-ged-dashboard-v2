/**
 * Exporta tablas de configuración a JSON (movementCodes, movementAliases, ruleSets, analysisNotes).
 * Uso: pnpm run config:export [-- --out scripts/data/config-export.json]
 *
 * El archivo se usa para migración o restauración (config-import.ts).
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
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL requerido en .env.local");
    process.exit(1);
  }

  const outIndex = process.argv.indexOf("--out");
  const outPath =
    outIndex >= 0 && process.argv[outIndex + 1]
      ? process.argv[outIndex + 1]
      : path.join(process.cwd(), "scripts", "data", "config-export.json");

  const client = new ConvexHttpClient(convexUrl);

  console.log("Exportando configuración...\n");

  const [movementCodes, movementAliases, ruleSetsList, analysisNotes] =
    await Promise.all([
      client.query(api.movementCodes.listMovementCodes, {}),
      client.query(api.movementCodes.listMovementAliases, {}),
      client.query(api.ruleSets.listRuleSets, { limit: 500 }),
      client.query(api.aggregatesCloudwatchQueries.getAnalysisNotes, {}),
    ]);

  const ruleSets: Array<{ ruleSetKey: string; domain: string; version: string; rules: unknown; activationPolicy: string; sourceKey?: string; createdBy?: string }> = [];
  for (const r of ruleSetsList as Array<{ _id: string }>) {
    const full = await client.query(api.ruleSets.getRuleSet, { id: r._id });
    if (full)
      ruleSets.push({
        ruleSetKey: full.ruleSetKey,
        domain: full.domain,
        version: full.version,
        rules: full.rules,
        activationPolicy: full.activationPolicy ?? "default",
        sourceKey: full.sourceKey,
        createdBy: full.createdBy,
      });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    movementCodes: movementCodes.map((r: { _id: string; codigo: string; descripcion: string; order?: number }) => ({
      codigo: r.codigo,
      descripcion: r.descripcion,
      order: r.order,
    })),
    movementAliases: movementAliases.map((r: { _id: string; variante: string; codigoCanonico: string }) => ({
      variante: r.variante,
      codigoCanonico: r.codigoCanonico,
    })),
    ruleSets,
    analysisNotes: analysisNotes.map((r: { _id: string; id: string; yearLabel: string; title?: string; content: string; accentColor: string; order: number }) => ({
      id: r.id,
      yearLabel: r.yearLabel,
      title: r.title,
      content: r.content,
      accentColor: r.accentColor,
      order: r.order,
    })),
  };

  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");

  console.log(`Exportado: ${outPath}`);
  console.log(`  movementCodes: ${payload.movementCodes.length}`);
  console.log(`  movementAliases: ${payload.movementAliases.length}`);
  console.log(`  ruleSets: ${payload.ruleSets.length}`);
  console.log(`  analysisNotes: ${payload.analysisNotes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
