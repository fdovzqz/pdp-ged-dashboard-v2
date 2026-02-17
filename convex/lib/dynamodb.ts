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
      ExpressionAttributeValues: {
        ":sg": { S: String(SYNC_GROUP) },
        ":dt": { S: sinceDate },
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
 * Query DynamoDB GSI DateIndex for items with syncGroup=1, updatedAt > sinceDate.
 * Extrae todos los registros (sin filtrar por status). Paginates until no more results.
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
        KeyConditionExpression: "syncGroup = :sg AND updatedAt > :dt",
        ExpressionAttributeValues: {
          ":sg": { S: String(SYNC_GROUP) },
          ":dt": { S: sinceDate },
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

/** Rango updatedAt para un día: primer y último instante (para BETWEEN inclusivo). DynamoDB solo permite una condición por clave. */
function dayRangeStrings(
  year: number,
  month: number,
  day: number
): { start: string; endInclusive: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-${pad(day)}`;
  const endInclusive = `${year}-${pad(month)}-${pad(day)}T23:59:59.999Z`;
  return { start, endInclusive };
}

/**
 * Una página de DynamoDB GSI DateIndex para un solo día.
 * syncGroup=1, updatedAt en [start, end). Usar Limit + ExclusiveStartKey para procesar por chunks (evita 524/600s).
 */
export async function queryDatamappingPageForDay(
  year: number,
  month: number,
  day: number,
  exclusiveStartKey?: string
): Promise<{
  items: Record<string, unknown>[];
  lastEvaluatedKey: string | null;
}> {
  const client = getDynamoClient();
  const tableName = getTableName();
  const { start: dtStart, endInclusive: dtEnd } = dayRangeStrings(year, month, day);
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
      KeyConditionExpression:
        "syncGroup = :sg AND updatedAt BETWEEN :dtStart AND :dtEnd",
      ExpressionAttributeValues: {
        ":sg": { S: String(SYNC_GROUP) },
        ":dtStart": { S: dtStart },
        ":dtEnd": { S: dtEnd },
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
 * Query DynamoDB GSI DateIndex para un solo día: syncGroup=1, updatedAt en [start, end).
 * Extrae todos los registros (sin filtrar por status).
 */
export async function* queryDatamappingPagoValidadoForDay(
  year: number,
  month: number,
  day: number
): AsyncGenerator<Record<string, unknown>> {
  const client = getDynamoClient();
  const tableName = getTableName();
  const { start: dtStart, endInclusive: dtEnd } = dayRangeStrings(year, month, day);
  let lastKey: Record<string, AttributeValue> | undefined = undefined;

  do {
    const response: QueryCommandOutput = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: DATAMAPPING_INDEX,
        KeyConditionExpression:
          "syncGroup = :sg AND updatedAt BETWEEN :dtStart AND :dtEnd",
        ExpressionAttributeValues: {
          ":sg": { S: String(SYNC_GROUP) },
          ":dtStart": { S: dtStart },
          ":dtEnd": { S: dtEnd },
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

/** Rango updatedAt para un mes: primer y último instante del mes (para BETWEEN inclusivo). DynamoDB solo permite una condición por clave, no ">= X AND < Y". */
function monthRangeStrings(year: number, month: number): {
  dtStart: string;
  dtEndInclusive: string;
} {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dtStart = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dtEndInclusive = `${year}-${pad(month)}-${pad(lastDay)}T23:59:59.999Z`;
  return { dtStart, dtEndInclusive };
}

/**
 * Query DynamoDB GSI DateIndex para un mes completo: syncGroup=1,
 * updatedAt en [firstDay, firstDayNextMonth).
 * Extrae todos los registros (sin filtrar por status). Paginado para procesar ~30k-100k+ por mes sin timeout.
 */
export async function queryDatamappingPageForMonth(
  year: number,
  month: number,
  exclusiveStartKey?: string
): Promise<{
  items: Record<string, unknown>[];
  lastEvaluatedKey: string | null;
}> {
  const client = getDynamoClient();
  const tableName = getTableName();
  const { dtStart, dtEndInclusive } = monthRangeStrings(year, month);
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
      KeyConditionExpression:
        "syncGroup = :sg AND updatedAt BETWEEN :dtStart AND :dtEnd",
      ExpressionAttributeValues: {
        ":sg": { S: String(SYNC_GROUP) },
        ":dtStart": { S: dtStart },
        ":dtEnd": { S: dtEndInclusive },
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
 * Maps a DynamoDB item (plain object after unmarshall) to the Convex datamappingRecords shape.
 * transactionId siempre está presente en DynamoDB (llave única).
 * referencia puede no existir y eso es válido.
 */
export function mapDynamoItemToRecord(item: Record<string, unknown>): {
  transactionId: string;
  referencia: string;
  monto: number;
  fechaPago?: string;
  fuente?: string;
  urlPago?: string;
  tipoMovimiento?: string;
  updatedAt: string;
  rawJson: string;
  status?: string;
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

  const transactionId =
    str("transactionId") ||
    str("TransactionId") ||
    str("transaction_id") ||
    str("id") ||
    str("Id");
  const referencia =
    str("referencia") || str("Referencia") || str("reference") || "";
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
  const status =
    str("status") || str("Status") || str("estatus") || str("Estatus");

  return {
    transactionId: (() => {
      if (!transactionId) {
        throw new Error(
          `DynamoDB item sin transactionId (obligatorio): keys=${JSON.stringify(Object.keys(item))}`
        );
      }
      return transactionId;
    })(),
    referencia: referencia || "",
    monto,
    ...(fechaPago ? { fechaPago } : {}),
    ...(fuente ? { fuente } : {}),
    ...(urlPago ? { urlPago } : {}),
    ...(tipoMovimiento ? { tipoMovimiento } : {}),
    updatedAt: updatedAt || new Date().toISOString(),
    rawJson: JSON.stringify(item),
    ...(status ? { status } : {}),
  };
}

/** RFC mexicano: 12-13 caracteres alfanuméricos (ej. BBA030609AM8, XAXX010101000). */
const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2}[0-9A]?$/i;

function looksLikeRfc(s: string): boolean {
  const trimmed = String(s ?? "").trim();
  return trimmed.length >= 10 && trimmed.length <= 14 && RFC_PATTERN.test(trimmed);
}

function extractRfcFromObj(obj: unknown): string | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  const keys = [
    "rfc",
    "RFC",
    "contribuyenteRfc",
    "contribuyente_rfc",
    "rfcContribuyente",
  ];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && looksLikeRfc(v)) return v.trim().toUpperCase();
  }
  const contribuyente = o.contribuyente ?? o.contribuyenteData ?? o.datosContribuyente;
  if (contribuyente && typeof contribuyente === "object") {
    const r = extractRfcFromObj(contribuyente);
    if (r) return r;
  }
  for (const v of Object.values(o)) {
    if (typeof v === "string" && looksLikeRfc(v)) return v.trim().toUpperCase();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const r = extractRfcFromObj(v);
      if (r) return r;
    }
  }
  return undefined;
}

/**
 * Extrae RFC del rawJson de un registro datamapping.
 * Busca en atributos comunes (rfc, contribuyenteRfc, etc.) y recursivamente en objetos anidados.
 */
export function extractRfcFromRawJson(rawJson: string): string | undefined {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return extractRfcFromObj(parsed);
  } catch {
    return undefined;
  }
}

/** Busca un string en obj o en objetos anidados (datos, payload, data, body). Claves: reciboPagoUrl, reciboPagoURL, etc. */
function getReciboPagoUrlFromObj(obj: Record<string, unknown>): string | undefined {
  const keys = [
    "reciboPagoUrl",
    "reciboPagoURL",
    "urlPago",
    "urlDePago",
    "url de pago",
    "mitUrl",
  ];
  const from = (o: Record<string, unknown> | null | undefined): string | undefined => {
    if (!o || typeof o !== "object") return undefined;
    for (const k of keys) {
      const v = o[k];
      if (v !== undefined && v !== null && typeof v === "string") {
        const t = v.trim();
        if (t !== "") return t;
      }
    }
    return undefined;
  };
  const atRoot = from(obj);
  if (atRoot) return atRoot;
  const nested = ["datos", "payload", "data", "body", "parameters", "params"];
  for (const key of nested) {
    const child = obj[key];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const inChild = from(child as Record<string, unknown>);
      if (inChild) return inChild;
    }
  }
  return undefined;
}

/** Busca un string en obj (raíz o anidado en datos, payload, data, body) para las claves dadas. */
function getStringFromObjOrNested(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  const from = (o: Record<string, unknown> | null | undefined): string | undefined => {
    if (!o || typeof o !== "object") return undefined;
    return getFirstStringPublic(o, ...keys);
  };
  const atRoot = from(obj);
  if (atRoot) return atRoot;
  for (const key of ["datos", "payload", "data", "body", "parameters", "params"]) {
    const child = obj[key];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const v = from(child as Record<string, unknown>);
      if (v) return v;
    }
  }
  return undefined;
}

/** Extrae status, fuente, loteId, reciboPagoUrl, endMonth y declarationType del rawJson (raíz o anidado). */
export function extractStatusAndFuenteFromRawJson(rawJson: string): {
  status?: string;
  fuente?: string;
  loteId?: string;
  reciboPagoUrl?: string;
  endMonth?: string;
  declarationType?: string;
} {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (parsed == null || typeof parsed !== "object") return {};
    const o = parsed as Record<string, unknown>;
    const status =
      getFirstStringPublic(o, "status", "Status", "estatus", "Estatus");
    const fuente =
      getFirstStringPublic(o, "fuente", "Fuente", "source", "Source");
    const loteId = getFirstStringPublic(o, "loteId", "lote_id", "lote");
    const reciboPagoUrl = getReciboPagoUrlFromObj(o);
    const endMonth = getStringFromObjOrNested(
      o,
      "endMonth",
      "end_month",
      "mesFin"
    );
    const declarationType = getStringFromObjOrNested(
      o,
      "declarationType",
      "declaration_type",
      "tipoDeclaracion",
      "tipo_declaracion"
    );
    return {
      ...(status ? { status } : {}),
      ...(fuente ? { fuente } : {}),
      ...(loteId ? { loteId } : {}),
      ...(reciboPagoUrl ? { reciboPagoUrl } : {}),
      ...(endMonth ? { endMonth } : {}),
      ...(declarationType ? { declarationType } : {}),
    };
  } catch {
    return {};
  }
}

function getFirstStringPublic(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : String(v);
    const trimmed = s.trim();
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

/** Devuelve el primer valor no nulo/undefined de obj para las claves dadas, normalizado a string. */
function getFirstString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v : String(v);
    const trimmed = s.trim();
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

/** Mapa campo → claves a buscar (orden) para extracción de enriquecimiento. */
const ENRICHMENT_KEY_MAP: Record<
  string,
  string[]
> = {
  placa: ["placa", "plate", "Plate"],
  evoId: ["evoId", "evo_id"],
  codiId: ["codiId", "codi_id"],
  expirationDate: [
    "expirationDate",
    "expiration_date",
    "fechaPago",
    "fechaDePago",
  ],
  folioNumber: ["folioNumber", "folio_number", "folio"],
  loteId: ["loteId", "lote_id", "lote"],
  procedureCategory: [
    "procedureCategory",
    "procedure_category",
    "categoria",
  ],
  tramiteId: ["tramiteId", "tramite_id", "tramite"],
  userId: ["userId", "user_id"],
  status: ["status", "Status", "estatus", "Estatus"],
  fuente: ["fuente", "Fuente", "source", "Source"],
};

export type EnrichmentFields = {
  rfc: string;
  placa?: string;
  evoId?: string;
  codiId?: string;
  expirationDate?: string;
  folioNumber?: string;
  loteId?: string;
  procedureCategory?: string;
  tramiteId?: string;
  userId?: string;
  status?: string;
  fuente?: string;
};

/**
 * Extrae todos los campos de enriquecimiento del rawJson (RFC + placa, evoId, etc.).
 * RFC usa la lógica existente; el resto busca claves a nivel raíz con alias camelCase/snake_case.
 */
export function extractEnrichmentFieldsFromRawJson(
  rawJson: string
): EnrichmentFields {
  const rfc = extractRfcFromRawJson(rawJson) ?? "";
  const out: EnrichmentFields = { rfc };

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (parsed == null || typeof parsed !== "object") return out;
    const o = parsed as Record<string, unknown>;

    for (const [field, keys] of Object.entries(ENRICHMENT_KEY_MAP)) {
      const val = getFirstString(o, ...keys);
      if (val !== undefined) {
        (out as Record<string, string | undefined>)[field] = val;
      }
    }
  } catch {
    // keep only rfc
  }
  return out;
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
      ExpressionAttributeValues: {
        ":sg": { S: String(SYNC_GROUP) },
        ":dt": { S: sinceDate },
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
