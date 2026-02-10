"use node";

import {
  DynamoDBClient,
  QueryCommand,
  type AttributeValue,
  type QueryCommandOutput,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const DATAMAPPING_INDEX = "DateIndex";
const SYNC_GROUP = 1;
const STATUS_PAGO_VALIDADO = "PAGO VALIDADO";

function getDynamoClient(): DynamoDBClient {
  return new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

function getTableName(): string {
  const name = process.env.DYNAMODB_DATAMAPPING_TABLE;
  if (!name) {
    throw new Error(
      "DYNAMODB_DATAMAPPING_TABLE is not set. Set it in Convex Dashboard → Settings → Environment Variables (e.g. datamappingtable-master-restored-4-feb-2026)."
    );
  }
  return name;
}

/** Tamaño de página por llamada (evita timeout de 600s). */
const DATAMAPPING_PAGE_LIMIT = 1000;

/**
 * Una página de DynamoDB GSI DateIndex. Para carga progresiva sin exceder 600s.
 * @param sinceDate - e.g. "2026-01-01"
 * @param exclusiveStartKey - LastEvaluatedKey serializado (JSON) de la llamada anterior
 */
export async function queryDatamappingPage(
  sinceDate: string,
  exclusiveStartKey?: string
): Promise<{
  items: Record<string, unknown>[];
  lastEvaluatedKey: string | null;
}> {
  const client = getDynamoClient();
  const tableName = getTableName();
  let lastKey: Record<string, AttributeValue> | undefined = undefined;
  if (exclusiveStartKey) {
    try {
      lastKey = JSON.parse(exclusiveStartKey) as Record<string, AttributeValue>;
    } catch {
      lastKey = undefined;
    }
  }
  const response: QueryCommandOutput = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: DATAMAPPING_INDEX,
      KeyConditionExpression: "syncGroup = :sg AND updatedAt > :dt",
      FilterExpression: "#st = :status",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":sg": { S: String(SYNC_GROUP) },
        ":dt": { S: sinceDate },
        ":status": { S: STATUS_PAGO_VALIDADO },
      },
      Limit: DATAMAPPING_PAGE_LIMIT,
      ExclusiveStartKey: lastKey,
    })
  );
  const items = (response.Items ?? []).map((item) =>
    unmarshall(item) as Record<string, unknown>
  );
  const nextKey = response.LastEvaluatedKey
    ? JSON.stringify(response.LastEvaluatedKey)
    : null;
  return { items, lastEvaluatedKey: nextKey };
}

/**
 * Query DynamoDB GSI DateIndex for items with syncGroup=1, updatedAt > sinceDate,
 * and FilterExpression status = "PAGO VALIDADO". Paginates until no more results.
 * @param sinceDate - e.g. "2026-01-01" or "2026-01-01T00:00:00.000Z"
 */
export async function* queryDatamappingPagoValidadoSince(
  sinceDate: string
): AsyncGenerator<Record<string, unknown>> {
  const client = getDynamoClient();
  const tableName = getTableName();
  let lastKey: Record<string, AttributeValue> | undefined = undefined;

  do {
    const response: QueryCommandOutput = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: DATAMAPPING_INDEX,
        KeyConditionExpression:
          "syncGroup = :sg AND updatedAt > :dt",
        FilterExpression: "#st = :status",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":sg": { S: String(SYNC_GROUP) },
          ":dt": { S: sinceDate },
          ":status": { S: STATUS_PAGO_VALIDADO },
        },
        ExclusiveStartKey: lastKey,
      })
    ) as QueryCommandOutput;

    const items = response.Items ?? [];
    for (const item of items) {
      yield unmarshall(item) as Record<string, unknown>;
    }
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
}

/** Fecha en rango para un día: YYYY-MM-DD y YYYY-MM-DD del día siguiente (para updatedAt < dtEnd). */
function dayRangeStrings(
  year: number,
  month: number,
  day: number
): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-${pad(day)}`;
  const next = new Date(year, month - 1, day + 1);
  const end = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  return { start, end };
}

/**
 * Query DynamoDB GSI DateIndex para un solo día: syncGroup=1, updatedAt en [start, end), status=PAGO VALIDADO.
 */
export async function* queryDatamappingPagoValidadoForDay(
  year: number,
  month: number,
  day: number
): AsyncGenerator<Record<string, unknown>> {
  const client = getDynamoClient();
  const tableName = getTableName();
  const { start: dtStart, end: dtEnd } = dayRangeStrings(year, month, day);
  let lastKey: Record<string, AttributeValue> | undefined = undefined;

  do {
    const response: QueryCommandOutput = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: DATAMAPPING_INDEX,
        KeyConditionExpression:
          "syncGroup = :sg AND updatedAt >= :dtStart AND updatedAt < :dtEnd",
        FilterExpression: "#st = :status",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":sg": { S: String(SYNC_GROUP) },
          ":dtStart": { S: dtStart },
          ":dtEnd": { S: dtEnd },
          ":status": { S: STATUS_PAGO_VALIDADO },
        },
        ExclusiveStartKey: lastKey,
      })
    ) as QueryCommandOutput;

    const items = response.Items ?? [];
    for (const item of items) {
      yield unmarshall(item) as Record<string, unknown>;
    }
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
}

/**
 * Maps a DynamoDB item (plain object after unmarshall) to the Convex datamappingRecords shape.
 * Tries common attribute name variants (referencia, total_pagar, fecha de pago, etc.).
 */
export function mapDynamoItemToRecord(item: Record<string, unknown>): {
  referencia: string;
  monto: number;
  fechaPago?: string;
  fuente?: string;
  urlPago?: string;
  tipoMovimiento?: string;
  updatedAt: string;
  rawJson: string;
} {
  const str = (key: string, alt?: string): string => {
    const v = item[key] ?? (alt ? item[alt] : undefined);
    if (v === undefined || v === null) return "";
    return String(v);
  };
  const num = (key: string, alt?: string): number => {
    const v = item[key] ?? (alt ? item[alt] : undefined);
    if (v === undefined || v === null) return 0;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  const referencia =
    str("referencia") || str("Referencia") || str("reference");
  const monto =
    num("monto", "total_pagar") ||
    num("total_pagar", "monto") ||
    num("amount");
  const fechaPago =
    str("fechaPago") ||
    str("fechaDePago") ||
    str("fecha de pago") ||
    str("expirationDate") ||
    str("createdAt");
  const fuente = str("fuente") || str("Fuente") || str("source");
  const urlPago =
    str("urlPago") ||
    str("urlDePago") ||
    str("url de pago") ||
    str("mitUrl");
  const tipoMovimiento =
    str("tipoMovimiento") ||
    str("tipo de movimiento") ||
    str("movimiento") ||
    str("tramite");
  const updatedAt = str("updatedAt") || str("UpdatedAt");

  return {
    referencia: referencia || "unknown",
    monto,
    ...(fechaPago ? { fechaPago } : {}),
    ...(fuente ? { fuente } : {}),
    ...(urlPago ? { urlPago } : {}),
    ...(tipoMovimiento ? { tipoMovimiento } : {}),
    updatedAt: updatedAt || new Date().toISOString(),
    rawJson: JSON.stringify(item),
  };
}

/**
 * Returns the list of attribute keys from the first item returned by the query.
 * Useful to confirm DynamoDB attribute names before finalizing column mapping.
 */
export async function listFirstItemAttributes(
  sinceDate: string
): Promise<{ keys: string[]; sampleRawJson?: string }> {
  const client = getDynamoClient();
  const tableName = getTableName();
  const response = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: DATAMAPPING_INDEX,
      KeyConditionExpression: "syncGroup = :sg AND updatedAt > :dt",
      FilterExpression: "#st = :status",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":sg": { S: String(SYNC_GROUP) },
        ":dt": { S: sinceDate },
        ":status": { S: STATUS_PAGO_VALIDADO },
      },
      Limit: 1,
    })
  );
  const items = response.Items ?? [];
  if (items.length === 0) return { keys: [] };
  const first = unmarshall(items[0]) as Record<string, unknown>;
  return {
    keys: Object.keys(first),
    sampleRawJson: JSON.stringify(first),
  };
}
