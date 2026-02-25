/**
 * Importa configuración desde JSON exportado por config-export.ts.
 * Uso: pnpm run config:import [-- --file scripts/data/config-export.json]
 *
 * Opcional: --clear antes de importar borra las tablas de config (movementCodes, movementAliases, ruleSets, analysisNotes).
 * Por defecto hace upsert (no borra datos existentes).
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

  const fileIndex = process.argv.indexOf("--file");
  const filePath =
    fileIndex >= 0 && process.argv[fileIndex + 1]
      ? process.argv[fileIndex + 1]
      : path.join(process.cwd(), "scripts", "data", "config-export.json");

  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as {
    exportedAt?: string;
    movementCodes: Array<{ codigo: string; descripcion: string; order?: number }>;
    movementAliases: Array<{ variante: string; codigoCanonico: string }>;
    ruleSets: Array<{ ruleSetKey: string; domain: string; version: string; rules: unknown; activationPolicy?: string; sourceKey?: string; createdBy?: string }>;
    analysisNotes: Array<{ id: string; yearLabel: string; title?: string; content: string; accentColor: string; order: number }>;
  };

  const client = new ConvexHttpClient(convexUrl);

  console.log(`Importando desde ${filePath} (exportado: ${data.exportedAt ?? "?"})\n`);

  if (process.argv.includes("--clear")) {
    console.log("Opción --clear: no implementada (borrar tablas de config requiere mutaciones internas).");
    console.log("Importación hará upsert sobre datos existentes.\n");
  }

  for (const row of data.movementCodes) {
    await client.mutation(api.movementCodes.upsertMovementCode, {
      codigo: row.codigo,
      descripcion: row.descripcion,
      order: row.order,
    });
  }
  console.log(`  movementCodes: ${data.movementCodes.length}`);

  for (const row of data.movementAliases) {
    await client.mutation(api.movementCodes.upsertMovementAlias, {
      variante: row.variante,
      codigoCanonico: row.codigoCanonico,
    });
  }
  console.log(`  movementAliases: ${data.movementAliases.length}`);

  for (const row of data.ruleSets) {
    await client.mutation(api.ruleSets.insertRuleSet, {
      ruleSetKey: row.ruleSetKey,
      domain: row.domain,
      version: row.version,
      rules: row.rules,
      activationPolicy: row.activationPolicy ?? "default",
      sourceKey: row.sourceKey,
      createdBy: row.createdBy,
    });
  }
  console.log(`  ruleSets: ${data.ruleSets.length}`);

  for (const row of data.analysisNotes) {
    await client.mutation(api.aggregatesCloudwatchMutations.upsertAnalysisNote, {
      id: row.id,
      yearLabel: row.yearLabel,
      title: row.title,
      content: row.content,
      accentColor: row.accentColor,
      order: row.order,
    });
  }
  console.log(`  analysisNotes: ${data.analysisNotes.length}`);

  console.log("\nImportación completada.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
