/**
 * Exporta a CSV todos los pagos recibidos en Enero 2026 según DynamoDB (fuente datamapping).
 * Rango en hora México (UTC-6): desde 1 Ene 00:00 hasta fin de 31 Ene.
 * Guarda el archivo en /data.
 *
 * Uso: npx tsx scripts/export-january-2026-payments-csv.ts
 * Requiere: .env.local con AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DYNAMODB_DATAMAPPING_TABLE
 */

import * as fs from "fs";
import * as path from "path";
import {
  DynamoDBClient,
  QueryCommand,
  type QueryCommandOutput,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

/** Enero 2026 en México (UTC-6): inicio = 1 Ene 00:00, fin = 31 Ene 23:59:59.999 (BETWEEN inclusivo). */
const JAN_2026_START_UTC = "2026-01-01T06:00:00.000Z";
const JAN_2026_END_UTC = "2026-02-01T05:59:59.999Z";

const OUTPUT_DIR = "data";
const OUTPUT_FILE = "pagos-enero-2026-dynamodb.csv";

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

function getStr(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = item[key];
    if (v !== undefined && v !== null) return String(v);
  }
  return "";
}

function getNum(item: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = item[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

type CsvRow = {
  reference: string;
  tramiteId: string;
  loteId: string;
  series: string;
  identifier: string;
  source: string;
  updatedAt: string;
};

function mapItemToRow(item: Record<string, unknown>): CsvRow {
  const reference =
    getStr(item, "referencia", "Referencia", "reference") || "";
  const tramiteId = getNum(item, "tramiteId", "tramite_id", "tramite")?.toString() ?? getStr(item, "tramiteId", "tramite_id", "tramite");
  const loteId = getNum(item, "loteId", "lote_id", "lote")?.toString() ?? getStr(item, "loteId", "lote_id", "lote");
  const series = getStr(item, "series", "seriesId", "series_id");
  const identifier = getStr(item, "identifier", "identificador", "id");
  const source = getStr(item, "source", "fuente", "Fuente");
  const updatedAt = getStr(item, "updatedAt", "UpdatedAt") || "";

  return {
    reference,
    tramiteId,
    loteId,
    series,
    identifier,
    source,
    updatedAt,
  };
}

/** Escapa un valor para CSV (comillas si contiene coma, salto de línea o comilla). */
function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function* queryJanuary2026(
  client: DynamoDBClient,
  tableName: string
): AsyncGenerator<Record<string, unknown>> {
  let lastKey: QueryCommandOutput["LastEvaluatedKey"] = undefined;
  do {
    const response = (await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "DateIndex",
        KeyConditionExpression:
          "syncGroup = :sg AND updatedAt BETWEEN :dtStart AND :dtEnd",
        FilterExpression: "#st = :status",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":sg": { S: "1" },
          ":dtStart": { S: JAN_2026_START_UTC },
          ":dtEnd": { S: JAN_2026_END_UTC },
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
  if (!tableName) {
    console.error("DYNAMODB_DATAMAPPING_TABLE no está definido en .env.local");
    process.exit(1);
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error(
      "AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY requeridos en .env.local"
    );
    process.exit(1);
  }

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const outDir = path.resolve(process.cwd(), OUTPUT_DIR);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, OUTPUT_FILE);

  const header = ["reference", "tramiteId", "loteId", "series", "identifier", "source", "updatedAt"];
  const fd = fs.openSync(outPath, "w");
  try {
    fs.writeFileSync(fd, header.map(escapeCsvValue).join(",") + "\n", "utf-8");

    let count = 0;
    const BATCH_WRITE = 1000;
    let batch: string[] = [];
    for await (const item of queryJanuary2026(client, tableName)) {
      const row = mapItemToRow(item);
      batch.push(
        [
          row.reference,
          row.tramiteId,
          row.loteId,
          row.series,
          row.identifier,
          row.source,
          row.updatedAt,
        ]
          .map(escapeCsvValue)
          .join(",")
      );
      count++;
      if (batch.length >= BATCH_WRITE) {
        fs.writeFileSync(fd, batch.join("\n") + "\n", "utf-8");
        batch = [];
      }
      if (count % 5000 === 0) {
        console.log("  Procesados:", count);
      }
    }
    if (batch.length > 0) {
      fs.writeFileSync(fd, batch.join("\n") + "\n", "utf-8");
    }
    console.log(
      "Listo. Total registros:",
      count,
      "→",
      path.join(OUTPUT_DIR, OUTPUT_FILE)
    );
  } finally {
    fs.closeSync(fd);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
