/**
 * Explora el primer item de DynamoDB (datamapping, GSI DateIndex, status PAGO VALIDADO).
 * Ejecuta en local leyendo AWS_* y DYNAMODB_DATAMAPPING_TABLE desde .env.local.
 *
 * Uso: npx tsx scripts/explore-dynamodb-local.ts [sinceDate]
 *      sinceDate por defecto: 2026-01-01
 */

import * as fs from "fs";
import * as path from "path";
import {
  DynamoDBClient,
  QueryCommand,
  DescribeTableCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

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

async function main(): Promise<void> {
  loadEnvLocal();

  const tableName = process.env.DYNAMODB_DATAMAPPING_TABLE;
  if (!tableName) {
    console.error("DYNAMODB_DATAMAPPING_TABLE no está definido en .env.local");
    process.exit(1);
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY requeridos en .env.local");
    process.exit(1);
  }

  const describeOnly = process.argv[2] === "--describe";
  const scanSample = process.argv[2] === "--scan";
  const sinceDate =
    describeOnly || scanSample
      ? "2026-01-01"
      : (process.argv[2] ?? "2026-01-01");
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  if (describeOnly) {
    const desc = await client.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    const table = desc.Table;
    if (!table) {
      console.log("Tabla no encontrada");
      return;
    }
    const dateIndex = table.GlobalSecondaryIndexes?.find(
      (g) => g.IndexName === "DateIndex"
    );
    if (!dateIndex) {
      console.log("GSI DateIndex no encontrado. Índices:", table.GlobalSecondaryIndexes?.map((g) => g.IndexName));
      return;
    }
    console.log("GSI DateIndex:");
    console.log("  KeySchema:", JSON.stringify(dateIndex.KeySchema, null, 2));
    const keyNames = new Set([
      ...(dateIndex.KeySchema?.map((k) => k.AttributeName) ?? []),
    ]);
    for (const attr of table.AttributeDefinitions ?? []) {
      if (attr.AttributeName && keyNames.has(attr.AttributeName)) {
        console.log("  ", attr.AttributeName, "->", attr.AttributeType);
      }
    }
    return;
  }

  if (scanSample) {
    const scanRes = await client.send(
      new ScanCommand({
        TableName: tableName,
        Limit: 1,
      })
    );
    const items = scanRes.Items ?? [];
    if (items.length === 0) {
      console.log("La tabla está vacía o no hay acceso.");
      return;
    }
    const first = unmarshall(items[0]) as Record<string, unknown>;
    const keys = Object.keys(first);
    console.log("Atributos del primer item (scan, cualquier status):", keys);
    console.log("");
    console.log("Sample rawJson (primeros 1200 caracteres):");
    console.log(JSON.stringify(first, null, 2).slice(0, 1200));
    if (JSON.stringify(first).length > 1200) console.log("...");
    return;
  }

  // GSI DateIndex: syncGroup (S), updatedAt (S) — ambos String en la tabla
  const response = await client.send(
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
      Limit: 1,
    })
  );

  const items = response.Items ?? [];
  if (items.length === 0) {
    console.log("No se encontraron items (syncGroup=1, updatedAt > %s, status=PAGO VALIDADO).", sinceDate);
    return;
  }

  const first = unmarshall(items[0]) as Record<string, unknown>;
  const keys = Object.keys(first);
  console.log("Atributos del primer item (DynamoDB):", keys);
  console.log("");
  console.log("Sample rawJson (primeros 800 caracteres):");
  console.log(JSON.stringify(first).slice(0, 800));
  if (JSON.stringify(first).length > 800) console.log("...");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
