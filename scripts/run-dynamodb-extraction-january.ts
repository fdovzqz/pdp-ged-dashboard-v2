/**
 * Extrae registros de DynamoDB (datamapping, GSI DateIndex, status PAGO VALIDADO, updatedAt > sinceDate)
 * e ingesta en Convex vía mutación ingestDatamappingBatch.
 * Usa .env.local para AWS y DYNAMODB_DATAMAPPING_TABLE; CONVEX_URL para Convex.
 *
 * Uso: npx tsx scripts/run-dynamodb-extraction-january.ts [sinceDate]
 *      sinceDate por defecto: 2026-01-01
 */

import * as fs from "fs";
import * as path from "path";
import {
  DynamoDBClient,
  QueryCommand,
  type QueryCommandOutput,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const BATCH_SIZE = 150;

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error(".env.local no encontrado");
    process.exit(1);
  }
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

function mapItem(item: Record<string, unknown>): {
  referencia: string;
  monto: number;
  fechaPago?: string;
  fuente?: string;
  urlPago?: string;
  tipoMovimiento?: string;
  updatedAt: string;
  rawJson: string;
} {
  const str = (key: string, ...alt: string[]): string => {
    const v =
      item[key] ??
      alt.map((a) => item[a]).find((x) => x !== undefined && x !== null);
    if (v === undefined || v === null) return "";
    return String(v);
  };
  const num = (key: string, ...alt: string[]): number => {
    const v =
      item[key] ??
      alt.map((a) => item[a]).find((x) => x !== undefined && x !== null);
    if (v === undefined || v === null) return 0;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };
  const referencia =
    str("referencia", "Referencia", "reference") || "unknown";
  const monto =
    num("monto", "total_pagar", "amount") || num("total_pagar", "monto");
  const fechaPago =
    str("fechaPago", "fechaDePago", "expirationDate", "createdAt") || undefined;
  const fuente = str("fuente", "Fuente", "source") || undefined;
  const urlPago = str("urlPago", "urlDePago", "mitUrl") || undefined;
  const tipoMovimiento =
    str("tipoMovimiento", "movimiento", "tramite") || undefined;
  const updatedAt = str("updatedAt", "UpdatedAt") || new Date().toISOString();

  return {
    referencia,
    monto,
    ...(fechaPago ? { fechaPago } : {}),
    ...(fuente ? { fuente } : {}),
    ...(urlPago ? { urlPago } : {}),
    ...(tipoMovimiento ? { tipoMovimiento } : {}),
    updatedAt,
    rawJson: JSON.stringify(item),
  };
}

async function* queryAll(
  client: DynamoDBClient,
  tableName: string,
  sinceDate: string
): AsyncGenerator<Record<string, unknown>> {
  let lastKey: QueryCommandOutput["LastEvaluatedKey"] = undefined;
  do {
    const response = (await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "DateIndex",
        KeyConditionExpression: "syncGroup = :sg AND updatedAt > :dt",
        FilterExpression: "#st = :status",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":sg": { S: "1" },
          ":dt": { S: sinceDate },
          ":status": { S: "PAGO VALIDADO" },
        },
        ExclusiveStartKey: lastKey,
      })
    )) as QueryCommandOutput;
    const items = response.Items ?? [];
    for (const item of items) {
      yield unmarshall(item) as Record<string, unknown>;
    }
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
}

async function main(): Promise<void> {
  loadEnvLocal();

  const tableName = process.env.DYNAMODB_DATAMAPPING_TABLE;
  const convexUrl =
    process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!tableName) {
    console.error("DYNAMODB_DATAMAPPING_TABLE no está definido en .env.local");
    process.exit(1);
  }
  if (!convexUrl) {
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL requerido en .env.local");
    process.exit(1);
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error(
      "AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY requeridos en .env.local"
    );
    process.exit(1);
  }

  const sinceDate = process.argv[2] ?? "2026-01-01";
  console.log("Extrayendo DynamoDB: updatedAt >", sinceDate, "status = PAGO VALIDADO");

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const convex = new ConvexHttpClient(convexUrl);
  const batch: Array<{
    referencia: string;
    monto: number;
    fechaPago?: string;
    fuente?: string;
    urlPago?: string;
    tipoMovimiento?: string;
    updatedAt: string;
    rawJson: string;
  }> = [];
  let totalIngested = 0;
  let batchCount = 0;

  for await (const item of queryAll(client, tableName, sinceDate)) {
    batch.push(mapItem(item));
    if (batch.length >= BATCH_SIZE) {
      const res = (await convex.mutation(
        api.datamappingMutations.upsertDatamappingBatch,
        { records: batch }
      )) as { inserted: number; updated: number };
      totalIngested += res.inserted + res.updated;
      batchCount += 1;
      console.log(
        "  Lote",
        batchCount,
        ":",
        res.inserted,
        "ins,",
        res.updated,
        "act (total",
        totalIngested,
        ")"
      );
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    const res = (await convex.mutation(
      api.datamappingMutations.upsertDatamappingBatch,
      { records: batch }
    )) as { inserted: number; updated: number };
    totalIngested += res.inserted + res.updated;
    batchCount += 1;
    console.log(
      "  Lote",
      batchCount,
      ":",
      res.inserted,
      "ins,",
      res.updated,
      "act (total",
      totalIngested,
      ")"
    );
  }

  console.log(
    "Listo. Total procesados (insertados + actualizados):",
    totalIngested,
    "en",
    batchCount,
    "lotes."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
