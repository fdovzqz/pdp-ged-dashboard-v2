/**
 * Explora el primer item de DynamoDB (datamapping, GSI DateIndex, status PAGO VALIDADO, updatedAt > sinceDate)
 * y muestra las keys del item para confirmar nombres de atributos antes de ingestar.
 *
 * Requiere: CONVEX_URL. Las credenciales AWS deben estar en Convex Dashboard (Environment Variables).
 *
 * Uso: CONVEX_URL=https://xxx.convex.cloud npx tsx scripts/explore-dynamodb-attributes.ts [sinceDate]
 *      sinceDate por defecto: 2026-01-01
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

async function main(): Promise<void> {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL requerido");
    process.exit(1);
  }
  const sinceDate = process.argv[2] ?? "2026-01-01";
  const client = new ConvexHttpClient(convexUrl);
  const result = await client.action(api.actions.exploreDatamappingAttributes, {
    sinceDate,
  });
  console.log("Atributos del primer item (DynamoDB):", result.keys);
  if (result.sampleRawJson) {
    console.log("Sample rawJson (primeros 500 chars):");
    console.log(result.sampleRawJson.slice(0, 500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
