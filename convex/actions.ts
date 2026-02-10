"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

/** Límite Convex: 600 segundos por acción. */
const ACTION_TIME_LIMIT_MS = 550_000;
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import { parseV1V2, parsePayment } from "./lib/parsers";
import { normalizeWithConfig } from "./movementCodes";
import {
  queryDatamappingPagoValidadoSince,
  queryDatamappingPagoValidadoForDay,
  queryDatamappingPage,
  mapDynamoItemToRecord,
  listFirstItemAttributes,
} from "./lib/dynamodb";
import { timestampToMexicoMonth } from "./lib/mexicoDate";

const LOG_GROUPS = {
  v1: process.env.CLOUDWATCH_LOG_GROUP_V1!,
  v2: process.env.CLOUDWATCH_LOG_GROUP_V2!,
  payment: process.env.CLOUDWATCH_LOG_GROUP_PAYMENT!,
} as const;

const client = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

async function fetchCloudWatch(
  version: "v1" | "v2" | "payment",
  startTimeSec: number,
  endTimeSec: number
): Promise<Array<Record<string, string>>> {
  const logGroup = LOG_GROUPS[version];
  const query =
    version === "payment"
      ? `fields @timestamp, @message, @logStream, @log
| filter details.parameters like /./
| parse details.parameters '"status":"*"' as status
| parse details.parameters '"tramite":"*"' as tramite
| parse details.parameters '"referencia":"*"' as referencia
| parse details.parameters '"total_pagar":"*"' as monto
| parse details.parameters '"movimiento":"*"' as movimiento
| parse details.parameters '"tipo":"*"' as tipo
| filter status like /PAGO VALIDADO/
| sort @timestamp desc
| limit 10000`
      : `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit 10000`;

  const startRes = await client.send(
    new StartQueryCommand({
      logGroupName: logGroup,
      startTime: startTimeSec,
      endTime: endTimeSec,
      queryString: query,
    })
  );
  if (!startRes.queryId) throw new Error("No queryId");

  let status: QueryStatus | undefined = QueryStatus.Running;
  let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
  let attempts = 0;

  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= 90) throw new Error("Query timeout (90s)");
    await new Promise((r) => setTimeout(r, 1000));
    const getRes = await client.send(
      new GetQueryResultsCommand({ queryId: startRes.queryId })
    );
    status = getRes.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      rawResults = getRes.results || [];
      break;
    }
  }

  return rawResults.map((row) => {
    const result: Record<string, string> = {};
    for (const f of row) {
      if (f.field && f.value) result[f.field] = f.value;
    }
    return result;
  });
}

export const fetchAndIngestForDate = action({
  args: {
    date: v.string(),
  },
  handler: async (ctx, { date }) => {
    // Borrar datos previos por importDate (en lotes, límite 4096 lecturas/mutación)
    let deleteByDateTotal = 0;
    while (true) {
      const res = (await ctx.runMutation(api.mutations.deletePaymentsByDate, {
        date,
      })) as { deleted: number };
      deleteByDateTotal += res.deleted;
      if (res.deleted === 0) break;
    }

    // Hora México (UTC-6): día local 00:00-23:59:59
    // 00:00 México = 06:00 UTC | 23:59:59 México = 05:59:59.999 UTC día sig
    const [y, mo, day] = date.split("-").map(Number);
    const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
    const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
    const startTimeSec = Math.floor(startUtc.getTime() / 1000);
    const endTimeSec = Math.floor(endUtc.getTime() / 1000);

    type Rec = {
      referencia: string;
      monto: number;
      timestamp: string;
      fechaTransaccion: string;
      logSource: "v1" | "v2" | "payment";
      movimiento: string;
      estatus: string;
      tramiteId?: number;
      importMonth: string;
      importDate: string;
    };
    const byRef = new Map<string, { logSource: string; rec: Rec }>();
    // Prioridad: Payment (PAGO VALIDADO) > V2 > V1
    // Si está en Payment es PAGO VALIDADO; si está en V1/V2 es exitoso (trámite encontrado en DB)
    const order = { payment: 0, v2: 1, v1: 2 };

    // Fetch las 3 fuentes en paralelo para respetar límite Convex de 600s por acción
    const [rowsV1, rowsV2, rowsPayment] = await Promise.all([
      fetchCloudWatch("v1", startTimeSec, endTimeSec).catch((e) => {
        console.error("[v1] Error:", e);
        return [] as Array<Record<string, string>>;
      }),
      fetchCloudWatch("v2", startTimeSec, endTimeSec).catch((e) => {
        console.error("[v2] Error:", e);
        return [] as Array<Record<string, string>>;
      }),
      fetchCloudWatch("payment", startTimeSec, endTimeSec).catch((e) => {
        console.error("[payment] Error:", e);
        return [] as Array<Record<string, string>>;
      }),
    ]);

    for (const [version, rows] of [
      ["v1", rowsV1],
      ["v2", rowsV2],
      ["payment", rowsPayment],
    ] as const) {
      const parsed =
        version === "payment"
          ? parsePayment(rows)
          : parseV1V2(rows, version);

      for (const p of parsed) {
        const existing = byRef.get(p.referencia);
        if (
          !existing ||
          order[version] < order[existing.logSource as keyof typeof order]
        ) {
          byRef.set(p.referencia, {
            logSource: version,
            rec: {
              referencia: p.referencia,
              monto: p.monto,
              timestamp: p.timestamp,
              fechaTransaccion: p.fechaTransaccion,
              logSource: p.logSource,
              movimiento: p.movimiento,
              estatus: p.estatus,
              tramiteId: p.tramiteId,
              importMonth: p.importMonth,
              importDate: p.importDate,
            },
          });
        }
      }
    }

    const records = Array.from(byRef.values()).map((x) => x.rec);
    const referencias = records.map((r) => r.referencia);

    // Borrar en lotes: límite 4096 lecturas/mutación (1 read por referencia)
    const DELETE_BATCH = 500;
    let deleteByRefTotal = 0;
    for (let i = 0; i < referencias.length; i += DELETE_BATCH) {
      const batch = referencias.slice(i, i + DELETE_BATCH);
      const res = (await ctx.runMutation(
        api.mutations.deletePaymentsByReferencias,
        { referencias: batch }
      )) as { deleted: number };
      deleteByRefTotal += res.deleted;
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    const BATCH = 100;

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const result = (await ctx.runMutation(api.mutations.ingestPaymentBatch, {
        records: batch,
      })) as { inserted: number; skipped: number };
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    }

    const month = date.substring(0, 7);
    const config = (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
      descriptions: {},
      aliases: {},
    };
    const byMov = new Map<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    >();
    let v1 = 0,
      v2 = 0,
      payment = 0;
    let v1Monto = 0,
      v2Monto = 0,
      paymentMonto = 0;
    for (const r of records) {
      if (r.logSource === "v1") {
        v1++;
        v1Monto += r.monto;
      } else if (r.logSource === "v2") {
        v2++;
        v2Monto += r.monto;
      } else {
        payment++;
        paymentMonto += r.monto;
      }
      const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
      const cur = byMov.get(mov) ?? {
        count: 0,
        monto: 0,
        v1: 0,
        v2: 0,
        payment: 0,
      };
      cur.count++;
      cur.monto += r.monto;
      if (r.logSource === "v1") cur.v1++;
      else if (r.logSource === "v2") cur.v2++;
      else cur.payment++;
      byMov.set(mov, cur);
    }
    const dayEntry = {
      date,
      count: records.length,
      monto: records.reduce((s, r) => s + r.monto, 0),
      v1,
      v2,
      payment,
      v1Monto,
      v2Monto,
      paymentMonto,
      byMovimiento: Array.from(byMov.entries()).map(([movimiento, d]) => ({
        movimiento,
        ...d,
      })),
      refs: [], // Omitir refs para evitar payload > 1 MiB (límite Convex)
    };
    await ctx.runMutation(api.mutations.updateMonthStatsFromDay, {
      month,
      dayEntry,
    });

    return {
      date,
      deleted: deleteByDateTotal + deleteByRefTotal,
      totalRecords: records.length,
      inserted: totalInserted,
      skipped: totalSkipped,
    };
  },
});

const DATAMAPPING_INGEST_BATCH = 150;
/** Límite Convex por acción. Procesamos hasta este número de registros por llamada. */
const MAX_ITEMS_PER_ACTION = 4000;

/** Carga DynamoDB → Convex por lotes de hasta 4000. El frontend llama en loop hasta hasMore=false. */
export const fetchDatamappingAndIngest = action({
  args: {
    sinceDate: v.string(),
    exclusiveStartKey: v.optional(v.string()),
  },
  handler: async (ctx, { sinceDate, exclusiveStartKey }) => {
    type DatamappingRec = {
      referencia: string;
      monto: number;
      fechaPago?: string;
      fuente?: string;
      urlPago?: string;
      tipoMovimiento?: string;
      updatedAt: string;
      rawJson: string;
    };
    const records: DatamappingRec[] = [];
    let cursor: string | undefined = exclusiveStartKey;
    while (records.length < MAX_ITEMS_PER_ACTION) {
      const { items, lastEvaluatedKey } = await queryDatamappingPage(
        sinceDate,
        cursor
      );
      for (const item of items) {
        records.push(
          mapDynamoItemToRecord(item as Record<string, unknown>)
        );
        if (records.length >= MAX_ITEMS_PER_ACTION) break;
      }
      cursor = lastEvaluatedKey ?? undefined;
      if (!cursor) break;
    }
    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < records.length; i += DATAMAPPING_INGEST_BATCH) {
      const batch = records.slice(i, i + DATAMAPPING_INGEST_BATCH);
      const result = (await ctx.runMutation(
        api.mutations.upsertDatamappingBatch,
        { records: batch }
      )) as { inserted: number; updated: number };
      inserted += result.inserted;
      updated += result.updated;
    }
    return {
      inserted,
      updated,
      lastEvaluatedKey: cursor ?? undefined,
      hasMore: cursor != null,
      pageCount: records.length,
    };
  },
});

/** Extrae un solo día de DynamoDB (updatedAt en ese día) y upserta en datamappingRecords. */
export const fetchDatamappingForDay = action({
  args: {
    year: v.number(),
    month: v.number(),
    day: v.number(),
  },
  handler: async (ctx, { year, month, day }) => {
    let inserted = 0;
    let updated = 0;
    let batchCount = 0;
    type DatamappingRec = {
      referencia: string;
      monto: number;
      fechaPago?: string;
      fuente?: string;
      urlPago?: string;
      tipoMovimiento?: string;
      updatedAt: string;
      rawJson: string;
    };
    const batch: DatamappingRec[] = [];

    for await (const item of queryDatamappingPagoValidadoForDay(
      year,
      month,
      day
    )) {
      batch.push(mapDynamoItemToRecord(item as Record<string, unknown>));
      if (batch.length >= DATAMAPPING_INGEST_BATCH) {
        const result = (await ctx.runMutation(
          api.mutations.upsertDatamappingBatch,
          { records: batch }
        )) as { inserted: number; updated: number };
        inserted += result.inserted;
        updated += result.updated;
        batchCount += 1;
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      const result = (await ctx.runMutation(
        api.mutations.upsertDatamappingBatch,
        { records: batch }
      )) as { inserted: number; updated: number };
      inserted += result.inserted;
      updated += result.updated;
      batchCount += 1;
    }
    return { inserted, updated, batchCount, day };
  },
});

/** Explora DynamoDB: devuelve las keys del primer item con status PAGO VALIDADO y updatedAt > sinceDate (para confirmar nombres de atributos). */
export const exploreDatamappingAttributes = action({
  args: { sinceDate: v.string() },
  handler: async (_ctx, { sinceDate }) => {
    return listFirstItemAttributes(sinceDate);
  },
});

const RECONCILIATION_CW_PAGE = 5000;
const RECONCILIATION_DDB_PAGE = 500;

/** Siguiente mes en formato YYYY-MM. */
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Lista de meses entre start y end (YYYY-MM) inclusive. */
function listMonthsInRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = nextMonth(cur);
  }
  return out;
}

/** Rango UTC para un mes en hora México (UTC-6): [día 1 00:00, día 1 siguiente 00:00). */
function monthToUtcRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 6, 0, 0, 0));
  const to = new Date(Date.UTC(y, m, 1, 6, 0, 0, 0));
  return {
    from: from.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    to: to.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  };
}

/**
 * Reconciliación: paymentRecords vs datamappingRecords en Convex.
 * Scope: "universe" (todo), "month" (un mes), "period" (rango de meses).
 */
export const runReconciliation = action({
  args: {
    scope: v.union(v.literal("universe"), v.literal("month"), v.literal("period")),
    month: v.optional(v.string()),
    startMonth: v.optional(v.string()),
    endMonth: v.optional(v.string()),
  },
  handler: async (ctx, { scope, month, startMonth, endMonth }) => {
    const startMs = Date.now();

    let scopeId: string;
    let cwMonths: string[];
    let ddbFrom: string | undefined;
    let ddbTo: string | undefined;

    if (scope === "universe") {
      scopeId = "universe";
      const allMonths = (await ctx.runQuery(api.queries.getAllMonthsStatus, {})) as { month: string }[];
      cwMonths = allMonths.map((m) => m.month).sort();
      if (cwMonths.length === 0) {
        throw new Error("No hay meses cargados en monthStats. Carga datos primero.");
      }
      ddbFrom = undefined;
      ddbTo = undefined;
    } else if (scope === "month") {
      if (!month) throw new Error("scope 'month' requiere month (YYYY-MM).");
      scopeId = month;
      cwMonths = [month];
      const r = monthToUtcRange(month);
      ddbFrom = r.from;
      ddbTo = r.to;
    } else {
      if (!startMonth || !endMonth) throw new Error("scope 'period' requiere startMonth y endMonth (YYYY-MM).");
      if (startMonth > endMonth) throw new Error("startMonth debe ser <= endMonth.");
      scopeId = `${startMonth}::${endMonth}`;
      cwMonths = listMonthsInRange(startMonth, endMonth);
      const rStart = monthToUtcRange(startMonth);
      const rEnd = monthToUtcRange(nextMonth(endMonth));
      ddbFrom = rStart.from;
      ddbTo = rEnd.to;
    }

    const byRefCw = new Map<
      string,
      {
        monto: number;
        logSource: "payment" | "v1" | "v2";
        importMonth: string;
        timestamp: string;
      }
    >();
    const order: Record<string, number> = { payment: 0, v2: 1, v1: 2 };
    let cwTotalRecords = 0;

    for (const m of cwMonths) {
      let cwCursor: string | null = null;
      do {
        if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
          throw new Error("Límite de tiempo alcanzado. Reconciliación incompleta.");
        }
        const cwResult = (await ctx.runQuery(
          api.queries.getPaymentRecordsPageWithDetails,
          {
            month: m,
            cursor: cwCursor ?? undefined,
            numItems: RECONCILIATION_CW_PAGE,
          }
        )) as {
          page: Array<{
            referencia: string;
            monto: number;
            logSource: string;
            importMonth?: string;
            timestamp?: string;
          }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        cwTotalRecords += cwResult.page.length;
        for (const r of cwResult.page) {
          const existing = byRefCw.get(r.referencia);
          if (
            !existing ||
            order[r.logSource] < order[existing.logSource as keyof typeof order]
          ) {
            byRefCw.set(r.referencia, {
              monto: r.monto,
              logSource: r.logSource as "payment" | "v1" | "v2",
              importMonth: r.importMonth ?? "",
              timestamp: r.timestamp ?? "",
            });
          }
        }
        if (cwResult.isDone) break;
        cwCursor = cwResult.continueCursor ?? null;
      } while (true);
    }

    const bySource = { payment: 0, v1: 0, v2: 0 };
    for (const [, { logSource }] of byRefCw) {
      bySource[logSource]++;
    }

    const byRefDdb = new Map<string, { monto: number; updatedAt: string }>();
    let ddbTotalRecords = 0;
    let ddbCursor: string | null = null;

    do {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
        throw new Error("Límite de tiempo alcanzado. Reconciliación incompleta.");
      }
      const ddbResult = (await ctx.runQuery(
        api.queries.getDatamappingPageByDateRange,
        {
          updatedAtFrom: ddbFrom,
          updatedAtTo: ddbTo,
          cursor: ddbCursor,
          numItems: RECONCILIATION_DDB_PAGE,
        }
      )) as {
        page: Array<{ referencia: string; monto: number; updatedAt: string }>;
        isDone: boolean;
        continueCursor: string | null;
      };
      ddbTotalRecords += ddbResult.page.length;
      for (const r of ddbResult.page) {
        byRefDdb.set(r.referencia, { monto: r.monto, updatedAt: r.updatedAt });
      }
      if (ddbResult.isDone) break;
      ddbCursor = ddbResult.continueCursor ?? null;
    } while (true);

    const onlyInCloudWatch: string[] = [];
    const onlyInDynamoDB: string[] = [];
    const inBothMatch: Array<{ referencia: string; monto: number }> = [];
    const inBothMonthMismatch: Array<{
      referencia: string;
      monto: number;
      importMonth: string;
      datamappingUpdatedAt: string;
      logSource: string;
    }> = [];
    const inBothMismatch: Array<{
      referencia: string;
      montoCloudWatch: number;
      montoDynamoDB: number;
      logSource: string;
    }> = [];

    for (const [ref, { monto, logSource, importMonth, timestamp }] of byRefCw) {
      if (!byRefDdb.has(ref)) {
        onlyInCloudWatch.push(ref);
      } else {
        const ddb = byRefDdb.get(ref)!;
        // Ambas fuentes en hora México (UTC-6): mes CW desde timestamp o importMonth, mes DDB desde updatedAt
        const cwMonth =
          timestamp && /^\d{4}/.test(timestamp)
            ? timestampToMexicoMonth(timestamp)
            : (importMonth ?? "").substring(0, 7);
        const ddbMonth = timestampToMexicoMonth(ddb.updatedAt ?? "");
        const sameMonth = cwMonth !== "" && ddbMonth !== "" && cwMonth === ddbMonth;
        if (monto === ddb.monto) {
          if (sameMonth) {
            inBothMatch.push({ referencia: ref, monto });
          } else {
            inBothMonthMismatch.push({
              referencia: ref,
              monto,
              importMonth: (cwMonth || importMonth) ?? "",
              datamappingUpdatedAt: ddb.updatedAt,
              logSource,
            });
          }
        } else {
          inBothMismatch.push({
            referencia: ref,
            montoCloudWatch: monto,
            montoDynamoDB: ddb.monto,
            logSource,
          });
        }
      }
    }
    for (const [ref] of byRefDdb) {
      if (!byRefCw.has(ref)) onlyInDynamoDB.push(ref);
    }

    // Excluir de "Solo en Datamapping" las refs que sí están en CloudWatch (otro mes) → pasan a monthMismatch
    const LOOKUP_CHUNK = 300;
    let onlyInDynamoDBFiltered = onlyInDynamoDB;
    if (onlyInDynamoDB.length > 0) {
      const cwMonthsByRef: Record<string, string> = {};
      for (let i = 0; i < onlyInDynamoDB.length; i += LOOKUP_CHUNK) {
        const chunk = onlyInDynamoDB.slice(i, i + LOOKUP_CHUNK);
        const part = (await ctx.runQuery(
          api.queries.getPaymentRecordsMonthsForReferencias,
          { referencias: chunk }
        )) as Record<string, string>;
        Object.assign(cwMonthsByRef, part);
      }
      for (const ref of Object.keys(cwMonthsByRef)) {
        const ddb = byRefDdb.get(ref)!;
        inBothMonthMismatch.push({
          referencia: ref,
          monto: ddb.monto,
          importMonth: cwMonthsByRef[ref] ?? "",
          datamappingUpdatedAt: ddb.updatedAt,
          logSource: "",
        });
      }
      onlyInDynamoDBFiltered = onlyInDynamoDB.filter((ref) => !(ref in cwMonthsByRef));
    }

    // Excluir de "Solo en CloudWatch" las refs que sí están en Datamapping (otro mes) → pasan a monthMismatch
    let onlyInCloudWatchFiltered = onlyInCloudWatch;
    if (onlyInCloudWatch.length > 0) {
      const ddbUpdatedAtByRef: Record<string, string> = {};
      for (let i = 0; i < onlyInCloudWatch.length; i += LOOKUP_CHUNK) {
        const chunk = onlyInCloudWatch.slice(i, i + LOOKUP_CHUNK);
        const part = (await ctx.runQuery(
          api.queries.getDatamappingUpdatedAtForReferencias,
          { referencias: chunk }
        )) as Record<string, string>;
        Object.assign(ddbUpdatedAtByRef, part);
      }
      for (const ref of Object.keys(ddbUpdatedAtByRef)) {
        const cw = byRefCw.get(ref)!;
        inBothMonthMismatch.push({
          referencia: ref,
          monto: cw.monto,
          importMonth: cw.importMonth ?? "",
          datamappingUpdatedAt: ddbUpdatedAtByRef[ref] ?? "",
          logSource: cw.logSource,
        });
      }
      onlyInCloudWatchFiltered = onlyInCloudWatch.filter((ref) => !(ref in ddbUpdatedAtByRef));
    }

    const onlyCwBySource = { payment: 0, v1: 0, v2: 0 };
    for (const ref of onlyInCloudWatchFiltered) {
      const s = byRefCw.get(ref)?.logSource;
      if (s) onlyCwBySource[s]++;
    }

    const totalUnique = byRefCw.size + onlyInDynamoDBFiltered.length; // refs únicas en total considerando ambos lados
    const matchCount = inBothMatch.length;
    const onlyCwCount = onlyInCloudWatchFiltered.length;
    const onlyDdbCount = onlyInDynamoDBFiltered.length;
    const mismatchCount = inBothMismatch.length;
    const monthMismatchCount = inBothMonthMismatch.length;

    // Limpiar tablas de errores (llamar mutation en loop)
    let cleared: { deleted: number };
    do {
      cleared = (await ctx.runMutation(
        api.mutations.clearReconciliationJanuary2026Batch,
        {}
      )) as { deleted: number };
    } while (cleared.deleted >= 400);
    // Escribir resumen
    await ctx.runMutation(api.mutations.setReconciliationSummaryJanuary2026, {
      scopeId,
      matchCount,
      onlyCwCount,
      onlyDdbCount,
      mismatchCount,
      monthMismatchCount,
      totalUnique: byRefCw.size + byRefDdb.size,
    });
    // Insertar errores en lotes
    const BATCH = 400;
    const onlyCwRecords = onlyInCloudWatchFiltered.map((ref) => {
      const x = byRefCw.get(ref)!;
      const cwMonthMexico =
        x.timestamp && /^\d{4}/.test(x.timestamp)
          ? timestampToMexicoMonth(x.timestamp)
          : (x.importMonth ?? "").substring(0, 7);
      return {
        kind: "onlyCw" as const,
        referencia: ref,
        monto: x.monto,
        logSource: x.logSource,
        importMonth: cwMonthMexico || x.importMonth || undefined,
      };
    });
    const onlyDdbRecords = onlyInDynamoDBFiltered.map((ref) => {
      const d = byRefDdb.get(ref)!;
      return {
        kind: "onlyDdb" as const,
        referencia: ref,
        monto: d.monto,
        datamappingUpdatedAt: d.updatedAt,
      };
    });
    const mismatchRecords = inBothMismatch.map((r) => {
      const cw = byRefCw.get(r.referencia)!;
      const ddb = byRefDdb.get(r.referencia)!;
      const cwMonthMexico =
        cw.timestamp && /^\d{4}/.test(cw.timestamp)
          ? timestampToMexicoMonth(cw.timestamp)
          : (cw.importMonth ?? "").substring(0, 7);
      return {
        kind: "mismatch" as const,
        referencia: r.referencia,
        montoCloudWatch: r.montoCloudWatch,
        montoDynamoDB: r.montoDynamoDB,
        logSource: r.logSource,
        importMonth: cwMonthMexico || cw.importMonth || undefined,
        datamappingUpdatedAt: ddb.updatedAt,
      };
    });
    const monthMismatchRecords = inBothMonthMismatch.map((r) => ({
      kind: "monthMismatch" as const,
      referencia: r.referencia,
      monto: r.monto,
      logSource: r.logSource,
      importMonth: r.importMonth || undefined,
      datamappingUpdatedAt: r.datamappingUpdatedAt,
    }));
    for (let i = 0; i < onlyCwRecords.length; i += BATCH) {
      await ctx.runMutation(api.mutations.insertReconciliationErrorsBatch, {
        records: onlyCwRecords.slice(i, i + BATCH),
      });
    }
    for (let i = 0; i < onlyDdbRecords.length; i += BATCH) {
      await ctx.runMutation(api.mutations.insertReconciliationErrorsBatch, {
        records: onlyDdbRecords.slice(i, i + BATCH),
      });
    }
    for (let i = 0; i < mismatchRecords.length; i += BATCH) {
      await ctx.runMutation(api.mutations.insertReconciliationErrorsBatch, {
        records: mismatchRecords.slice(i, i + BATCH),
      });
    }
    for (let i = 0; i < monthMismatchRecords.length; i += BATCH) {
      await ctx.runMutation(api.mutations.insertReconciliationErrorsBatch, {
        records: monthMismatchRecords.slice(i, i + BATCH),
      });
    }

    return {
      scopeId,
      cloudWatch: {
        totalRecords: cwTotalRecords,
        uniqueReferencias: byRefCw.size,
        bySourceRecords: bySource,
        bySourceUniqueRefs: {
          payment: bySource.payment,
          v1: bySource.v1,
          v2: bySource.v2,
        },
      },
      datamapping: {
        totalRecords: ddbTotalRecords,
        uniqueReferencias: byRefDdb.size,
        filter: { updatedAtFrom: ddbFrom ?? "(todo)", updatedAtTo: ddbTo ?? "(todo)" },
        truncated: false,
      },
      differences: {
        onlyInCloudWatch: onlyCwCount,
        onlyInDynamoDB: onlyDdbCount,
        inBothMatch: matchCount,
        inBothMismatch: mismatchCount,
        inBothMonthMismatch: monthMismatchCount,
        onlyInCloudWatchBySource: onlyCwBySource,
      },
      summary: {
        matchCount,
        onlyCwCount,
        onlyDdbCount,
        mismatchCount,
        monthMismatchCount,
        totalUnique: byRefCw.size + byRefDdb.size,
      },
      samples: {
        onlyInCloudWatch: onlyInCloudWatchFiltered.slice(0, 100),
        onlyInDynamoDB: onlyInDynamoDBFiltered.slice(0, 100),
        inBothMismatch: inBothMismatch.slice(0, 50),
        inBothMonthMismatch: inBothMonthMismatch.slice(0, 50),
        inBothMatch: inBothMatch.slice(0, 30),
      },
    };
  },
});

/** Alias: reconciliación solo Enero 2026 (compatibilidad con enlaces antiguos). */
export const getJanuary2026Reconciliation = action({
  args: {},
  handler: async (ctx): Promise<{
    scopeId: string;
    cloudWatch: unknown;
    datamapping: unknown;
    differences: unknown;
    summary: unknown;
    samples: unknown;
  }> => {
    return await ctx.runAction(api.actions.runReconciliation, {
      scope: "month",
      month: "2026-01",
    });
  },
});

const RECONCILIATION_ERRORS_COUNT_PAGE = 2000;

/** Devuelve el número de errores por mes para un tipo (onlyCw | onlyDdb | mismatch | monthMismatch). */
export const getReconciliationErrorsCountByMonth = action({
  args: {
    kind: v.union(
      v.literal("onlyCw"),
      v.literal("onlyDdb"),
      v.literal("mismatch"),
      v.literal("monthMismatch")
    ),
  },
  handler: async (ctx, { kind }): Promise<{ countsByMonth: Record<string, number> }> => {
    const countsByMonth: Record<string, number> = {};
    let cursor: string | null = null;
    do {
      const result = (await ctx.runQuery(api.queries.getReconciliationErrorsPage, {
        kind,
        cursor,
        numItems: RECONCILIATION_ERRORS_COUNT_PAGE,
      })) as {
        page: Array<{
          importMonth?: string;
          datamappingUpdatedAt?: string;
        }>;
        isDone: boolean;
        continueCursor: string | null;
      };
      for (const doc of result.page) {
        const month =
          (doc.importMonth != null && doc.importMonth !== ""
            ? doc.importMonth.substring(0, 7)
            : null) ??
          (doc.datamappingUpdatedAt != null && doc.datamappingUpdatedAt !== ""
            ? timestampToMexicoMonth(doc.datamappingUpdatedAt)
            : null) ??
          "—";
        countsByMonth[month] = (countsByMonth[month] ?? 0) + 1;
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    } while (true);
    return { countsByMonth };
  },
});

/** Regenera monthStats desde paymentRecords. Útil cuando ya hay datos pero monthStats está vacío. */
export const recreateMonthStatsFromPaymentRecords = action({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const startTime = Date.now();
    const PAGE_SIZE = 1000;
    let cursor: string | null = null;

    const referenciasSet = new Set<string>();
    const diasSet = new Set<string>();
    const porFuente: Record<string, number> = { v1: 0, v2: 0, payment: 0 };
    const montoPorFuente: Record<string, number> = { v1: 0, v2: 0, payment: 0 };
    const byDay = new Map<
      string,
      {
        count: number;
        monto: number;
        v1: number;
        v2: number;
        payment: number;
        v1Monto: number;
        v2Monto: number;
        paymentMonto: number;
        byMovimiento: Map<
          string,
          { count: number; monto: number; v1: number; v2: number; payment: number }
        >;
        refs: string[];
      }
    >();
    const config = (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
      descriptions: {},
      aliases: {},
    };
    const byMovimiento = new Map<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    >();

    const [year, mon] = month.split("-").map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      byDay.set(dateStr, {
        count: 0,
        monto: 0,
        v1: 0,
        v2: 0,
        payment: 0,
        v1Monto: 0,
        v2Monto: 0,
        paymentMonto: 0,
        byMovimiento: new Map(),
        refs: [],
      });
    }

    type Rec = {
      referencia: string;
      monto: number;
      timestamp: string;
      importDate?: string;
      logSource: "v1" | "v2" | "payment";
      movimiento: string;
    };

    while (true) {
      if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
        throw new Error(
          "Límite de tiempo alcanzado (550s). Mes con demasiados registros."
        );
      }

      const result = (await ctx.runQuery(
        api.queries.getPaymentsByMonthPaginated,
        {
          month,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        }
      )) as {
        page: Rec[];
        isDone: boolean;
        continueCursor: string | null;
      };

      for (const r of result.page) {
        referenciasSet.add(r.referencia);
        const dateStr = r.importDate ?? r.timestamp?.substring(0, 10) ?? "";
        if (dateStr) diasSet.add(dateStr);

        porFuente[r.logSource] = (porFuente[r.logSource] || 0) + 1;
        montoPorFuente[r.logSource] =
          (montoPorFuente[r.logSource] || 0) + r.monto;

        const dayData = byDay.get(dateStr);
        if (dayData) {
          dayData.count += 1;
          dayData.monto += r.monto;
          dayData.refs.push(r.referencia);
          if (r.logSource === "v1") {
            dayData.v1 += 1;
            dayData.v1Monto += r.monto;
          } else if (r.logSource === "v2") {
            dayData.v2 += 1;
            dayData.v2Monto += r.monto;
          } else {
            dayData.payment += 1;
            dayData.paymentMonto += r.monto;
          }

          const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
          const movCur = dayData.byMovimiento.get(mov) ?? {
            count: 0,
            monto: 0,
            v1: 0,
            v2: 0,
            payment: 0,
          };
          movCur.count += 1;
          movCur.monto += r.monto;
          if (r.logSource === "v1") movCur.v1 += 1;
          else if (r.logSource === "v2") movCur.v2 += 1;
          else movCur.payment += 1;
          dayData.byMovimiento.set(mov, movCur);
        }

        const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
        const movGlobal = byMovimiento.get(mov) ?? {
          count: 0,
          monto: 0,
          v1: 0,
          v2: 0,
          payment: 0,
        };
        movGlobal.count += 1;
        movGlobal.monto += r.monto;
        if (r.logSource === "v1") movGlobal.v1 += 1;
        else if (r.logSource === "v2") movGlobal.v2 += 1;
        else movGlobal.payment += 1;
        byMovimiento.set(mov, movGlobal);
      }

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    const totalPagos = Array.from(byDay.values()).reduce((s, d) => s + d.count, 0);
    const montoTotal = Array.from(byDay.values()).reduce((s, d) => s + d.monto, 0);
    const diasConDatos = Array.from(byDay.values()).filter((d) => d.count > 0)
      .length;
    const promedioDiario =
      diasConDatos > 0 ? Math.round(totalPagos / diasConDatos) : 0;

    const dayEntries = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        count: d.count,
        monto: d.monto,
        v1: d.v1,
        v2: d.v2,
        payment: d.payment,
        v1Monto: d.v1Monto,
        v2Monto: d.v2Monto,
        paymentMonto: d.paymentMonto,
        byMovimiento: Array.from(d.byMovimiento.entries()).map(
          ([movimiento, data]) => ({ movimiento, ...data })
        ),
        refs: [], // Omitir refs para evitar payload > 1 MiB; referenciasUnicas ya en kpis
      }));

    const dailyBreakdown = dayEntries.map((e) => ({
      date: e.date,
      count: e.count,
      monto: e.monto,
      v1: e.v1,
      v2: e.v2,
      payment: e.payment,
      v1Monto: e.v1Monto,
      v2Monto: e.v2Monto,
      paymentMonto: e.paymentMonto,
    }));

    const movementStats = Array.from(byMovimiento.entries())
      .map(([movimiento, data]) => ({ movimiento, ...data }))
      .sort((a, b) => b.count - a.count);

    const sources = ["v1", "v2", "payment"] as const;
    const sourceStats = sources.map((source) => {
      const count = porFuente[source] ?? 0;
      const monto = montoPorFuente[source] ?? 0;
      return {
        source,
        count,
        monto,
        pctCount: totalPagos > 0 ? (count / totalPagos) * 100 : 0,
        pctMonto: montoTotal > 0 ? (monto / montoTotal) * 100 : 0,
      };
    });

    const byDate = dayEntries
      .filter((e) => e.count > 0)
      .map((e) => ({ date: e.date, count: e.count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    await ctx.runMutation(api.mutations.setMonthStatsFromAggregation, {
      payload: {
        month,
        dayEntries,
        kpis: {
          totalPagos,
          montoTotal,
          referenciasUnicas: referenciasSet.size,
          promedioDiario,
          diasConDatos,
          porFuente,
        },
        dailyBreakdown,
        movementStats,
        sourceStats,
        ingestionStatus: {
          totalRecords: totalPagos,
          daysWithData: byDate.length,
          byDate,
        },
      },
    });

    return {
      month,
      totalPagos,
      montoTotal,
      referenciasUnicas: referenciasSet.size,
    };
  },
});

/** Genera lista de meses YYYY-MM entre start y end inclusive. */
function generateMonthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/**
 * Verifica si hay referencias duplicadas en paymentRecords.
 * Itera por mes para respetar límites de lectura.
 */
export const checkDuplicateReferencias = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit: limitArg }) => {
    const maxResults = limitArg ?? 50;
    const months = generateMonthRange("2024-01", "2026-02");
    const countByRef = new Map<string, number>();

    for (const month of months) {
      let cursor: string | undefined;
      do {
        const result = await ctx.runQuery(api.queries.getPaymentRecordsPageByMonth, {
          month,
          cursor,
          numItems: 5000,
        });
        for (const ref of result.page) {
          countByRef.set(ref, (countByRef.get(ref) ?? 0) + 1);
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);
    }

    const duplicates: Array<{ referencia: string; count: number }> = [];
    for (const [ref, count] of countByRef) {
      if (count > 1) {
        duplicates.push({ referencia: ref, count });
      }
    }

    duplicates.sort((a, b) => b.count - a.count);

    let totalRecords = 0;
    for (const [, c] of countByRef) {
      totalRecords += c;
    }

    return {
      totalRecords,
      uniqueReferencias: countByRef.size,
      duplicateReferencias: duplicates.length,
      totalDuplicateRecords: duplicates.reduce((s, d) => s + d.count, 0),
      top: duplicates.slice(0, maxResults),
    };
  },
});

/**
 * Diagnóstico: compara datos de marzo 2025 días 1-6 entre paymentRecords,
 * monthStats y dailyData.
 */
export const diagnoseMarch2025Days1to6 = action({
  args: {},
  handler: async (ctx) => {
    const month = "2025-03";
    const targetDates = ["2025-03-01", "2025-03-02", "2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06"];

    const byDateFromPayments: Record<string, { count: number; monto: number }> = {};
    for (const d of targetDates) {
      byDateFromPayments[d] = { count: 0, monto: 0 };
    }

    let cursor: string | undefined;
    do {
      const result = await ctx.runQuery(api.queries.getPaymentRecordsPageWithDetails, {
        month,
        cursor,
        numItems: 5000,
      });
      for (const r of result.page) {
        const dateStr = r.importDate ?? "";
        if (dateStr && byDateFromPayments[dateStr]) {
          byDateFromPayments[dateStr].count += 1;
          byDateFromPayments[dateStr].monto += r.monto;
        }
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    } while (cursor);

    const monthStats = await ctx.runQuery(api.queries.getMonthStats, { month });
    const dayEntriesFromMonthStats = monthStats?.dailyBreakdown?.days ?? [];
    const byDateFromMonthStats: Record<string, { count: number; monto: number }> = {};
    for (const d of targetDates) {
      byDateFromMonthStats[d] = { count: 0, monto: 0 };
    }
    for (const entry of dayEntriesFromMonthStats) {
      const dateStr = entry.date;
      if (byDateFromMonthStats[dateStr]) {
        byDateFromMonthStats[dateStr] = {
          count: entry.count,
          monto: entry.monto,
        };
      }
    }

    const dailyData = await ctx.runQuery(api.januaryQueries.getDailyDataForDays, {
      year: 2025,
      month: 3,
      days: [1, 2, 3, 4, 5, 6],
    }) as Array<{ day: number; events: number; totalAmount: number }>;
    const byDateFromDailyData: Record<string, { count: number; monto: number }> = {};
    for (const d of targetDates) {
      byDateFromDailyData[d] = { count: 0, monto: 0 };
    }
    for (const row of dailyData) {
      const dateStr = `${month}-${String(row.day).padStart(2, "0")}`;
      if (byDateFromDailyData[dateStr]) {
        byDateFromDailyData[dateStr] = {
          count: row.events,
          monto: row.totalAmount,
        };
      }
    }

    const comparison: Array<{
      date: string;
      paymentRecords: { count: number; monto: number };
      monthStats: { count: number; monto: number };
      dailyData: { count: number; monto: number };
      countMatch: boolean;
      montoMatch: boolean;
      issues: string[];
    }> = [];

    for (const dateStr of targetDates) {
      const pr = byDateFromPayments[dateStr];
      const ms = byDateFromMonthStats[dateStr];
      const dd = byDateFromDailyData[dateStr];
      const issues: string[] = [];
      if (pr.count !== ms.count) {
        issues.push(`count: paymentRecords(${pr.count}) ≠ monthStats(${ms.count})`);
      }
      if (pr.count !== dd.count) {
        issues.push(`count: paymentRecords(${pr.count}) ≠ dailyData(${dd.count})`);
      }
      if (ms.count !== dd.count) {
        issues.push(`count: monthStats(${ms.count}) ≠ dailyData(${dd.count})`);
      }
      if (Math.abs(pr.monto - ms.monto) > 1) {
        issues.push(`monto: paymentRecords(${pr.monto}) ≠ monthStats(${ms.monto})`);
      }
      if (Math.abs(pr.monto - dd.monto) > 1) {
        issues.push(`monto: paymentRecords(${pr.monto}) ≠ dailyData(${dd.monto})`);
      }
      if (Math.abs(ms.monto - dd.monto) > 1) {
        issues.push(`monto: monthStats(${ms.monto}) ≠ dailyData(${dd.monto})`);
      }
      comparison.push({
        date: dateStr,
        paymentRecords: pr,
        monthStats: ms,
        dailyData: dd,
        countMatch: pr.count === ms.count && pr.count === dd.count,
        montoMatch: Math.abs(pr.monto - ms.monto) <= 1 && Math.abs(pr.monto - dd.monto) <= 1,
        issues,
      });
    }

    return {
      month,
      comparison,
      summary: {
        totalPaymentRecords: Object.values(byDateFromPayments).reduce((s, d) => s + d.count, 0),
        totalMonthStats: Object.values(byDateFromMonthStats).reduce((s, d) => s + d.count, 0),
        totalDailyData: Object.values(byDateFromDailyData).reduce((s, d) => s + d.count, 0),
        daysWithIssues: comparison.filter((c) => c.issues.length > 0).length,
      },
    };
  },
});

/**
 * Diagnóstico de todos los meses: compara totales entre paymentRecords,
 * monthStats y dailyData. Detecta meses con datos inconsistentes.
 */
export const diagnoseAllMonths = action({
  args: {},
  handler: async (ctx) => {
    const months = generateMonthRange("2024-01", "2026-02");
    const results: Array<{
      month: string;
      paymentRecords: { count: number; monto: number };
      monthStats: { count: number; monto: number } | null;
      dailyData: { count: number; monto: number };
      hasIssues: boolean;
      issues: string[];
    }> = [];

    for (const month of months) {
      const [year, monthNum] = month.split("-").map(Number);

      let prCount = 0;
      let prMonto = 0;
      let cursor: string | undefined;
      do {
        const result = await ctx.runQuery(api.queries.getPaymentRecordsPageWithDetails, {
          month,
          cursor,
          numItems: 5000,
        });
        for (const r of result.page) {
          prCount += 1;
          prMonto += r.monto;
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);

      const monthStats = await ctx.runQuery(api.queries.getMonthStats, { month });
      const msCount = monthStats?.kpis?.totalPagos ?? 0;
      const msMonto = monthStats?.kpis?.montoTotal ?? 0;

      const ddResult = await ctx.runQuery(api.januaryQueries.getDailyDataMonthlyTotals, {
        year,
        month: monthNum,
      });
      const ddCount = ddResult?.events ?? 0;
      const ddMonto = ddResult?.totalAmount ?? 0;

      const issues: string[] = [];
      if (prCount !== msCount && monthStats) {
        issues.push(`count: paymentRecords(${prCount}) ≠ monthStats(${msCount})`);
      }
      if (prCount !== ddCount) {
        issues.push(`count: paymentRecords(${prCount}) ≠ dailyData(${ddCount})`);
      }
      if (monthStats && msCount !== ddCount) {
        issues.push(`count: monthStats(${msCount}) ≠ dailyData(${ddCount})`);
      }
      if (Math.abs(prMonto - msMonto) > 1 && monthStats) {
        issues.push(`monto: paymentRecords(${prMonto}) ≠ monthStats(${msMonto})`);
      }
      if (Math.abs(prMonto - ddMonto) > 1) {
        issues.push(`monto: paymentRecords(${prMonto}) ≠ dailyData(${ddMonto})`);
      }
      if (monthStats && Math.abs(msMonto - ddMonto) > 1) {
        issues.push(`monto: monthStats(${msMonto}) ≠ dailyData(${ddMonto})`);
      }

      results.push({
        month,
        paymentRecords: { count: prCount, monto: prMonto },
        monthStats: monthStats ? { count: msCount, monto: msMonto } : null,
        dailyData: { count: ddCount, monto: ddMonto },
        hasIssues: issues.length > 0,
        issues,
      });
    }

    const monthsWithIssues = results.filter((r) => r.hasIssues);

    return {
      totalMonths: months.length,
      monthsWithIssues: monthsWithIssues.length,
      monthsWithIssuesList: monthsWithIssues.map((r) => r.month),
      details: monthsWithIssues.map((r) => ({
        month: r.month,
        paymentRecords: r.paymentRecords,
        monthStats: r.monthStats,
        dailyData: r.dailyData,
        issues: r.issues,
      })),
      allResults: results,
    };
  },
});

/**
 * Elimina datos de febrero 2026 del día 9 en adelante (aún no han ocurrido).
 * Borra paymentRecords, regenera monthStats y agregados (dailyData, etc.).
 */
export const trimFebruary2026FutureData = action({
  args: {},
  handler: async (ctx) => {
    const month = "2026-02";
    const minDateToDelete = "2026-02-09";
    const PAGE_SIZE = 500;
    const BATCH_DELETE = 400;
    let cursor: string | null = null;
    let totalDeleted = 0;

    // 1. Eliminar paymentRecords con fechaTransaccion >= 2026-02-09
    while (true) {
      const result = (await ctx.runQuery(
        api.queries.getPaymentsByMonthPaginated,
        {
          month,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        }
      )) as {
        page: Array<{ _id: Id<"paymentRecords">; fechaTransaccion: string }>;
        isDone: boolean;
        continueCursor: string | null;
      };

      const toDelete = result.page
        .filter((r) => r.fechaTransaccion >= minDateToDelete)
        .map((r) => r._id);

      for (let i = 0; i < toDelete.length; i += BATCH_DELETE) {
        const batch = toDelete.slice(i, i + BATCH_DELETE);
        const res = await ctx.runMutation(api.mutations.deletePaymentsByIds, {
          ids: batch,
        });
        totalDeleted += res.deleted;
      }

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    // 2. Regenerar monthStats desde paymentRecords
    await ctx.runAction(api.actions.recreateMonthStatsFromPaymentRecords, {
      month,
    });

    // 3. Regenerar agregados (dailyData, rawHourlyData, etc.)
    await ctx.runAction(api.januaryETL.buildJanuaryAggregates, {
      months: [month],
    });

    return {
      paymentRecordsDeleted: totalDeleted,
      monthStatsRegenerated: true,
      aggregatesRegenerated: true,
    };
  },
});

function isPagado(estatus: string): boolean {
  const u = (estatus ?? "").toUpperCase().trim();
  return u === "PAGADO" || u === "PAGO VALIDADO" || u === "PA";
}

/**
 * Referencias de un mes que exceden un monto mínimo y tienen estatus PAGADO (PAGO VALIDADO).
 */

/**
 * Diagnóstico: distribución V1/V2/payment por día para Marzo 2024 y 2025.
 * Ayuda a detectar si solo un día tiene V1 (p. ej. sospecha de fecha incorrecta).
 */
export const diagnoseMarchV1Distribution = action({
  args: {},
  handler: async (ctx) => {
    const months = ["2024-03", "2025-03", "2025-04"];
    const results: Array<{
      month: string;
      totalV1: number;
      totalV2: number;
      totalPayment: number;
      daysWithV1: Array<{ date: string; v1: number; v2: number; payment: number }>;
      allDays: Array<{ date: string; v1: number; v2: number; payment: number }>;
    }> = [];

    for (const month of months) {
      const doc = await ctx.runQuery(api.queries.getMonthStats, { month });
      const breakdown = doc?.dailyBreakdown as { days?: Array<{ date: string; v1: number; v2: number; payment: number }> } | undefined;
      const entries = breakdown?.days ?? [];

      const daysWithV1 = entries.filter((d) => d.v1 > 0);
      const totalV1 = entries.reduce((s, d) => s + (d.v1 ?? 0), 0);
      const totalV2 = entries.reduce((s, d) => s + (d.v2 ?? 0), 0);
      const totalPayment = entries.reduce((s, d) => s + (d.payment ?? 0), 0);

      results.push({
        month,
        totalV1,
        totalV2,
        totalPayment,
        daysWithV1: daysWithV1.map((d) => ({ date: d.date, v1: d.v1, v2: d.v2 ?? 0, payment: d.payment ?? 0 })),
        allDays: entries.slice(0, 35).map((d) => ({ date: d.date, v1: d.v1 ?? 0, v2: d.v2 ?? 0, payment: d.payment ?? 0 })),
      });
    }

    // También verificar paymentRecords directamente (puede diferir de monthStats)
    const byMonthFromRecords: Record<string, Map<string, { v1: number; v2: number; payment: number }>> = {};
    for (const month of months) {
      const byDay = new Map<string, { v1: number; v2: number; payment: number }>();
      let cursor: string | undefined;
      do {
        const result = await ctx.runQuery(api.queries.getPaymentRecordsPageWithDetails, {
          month,
          cursor,
          numItems: 5000,
        });
        for (const r of result.page) {
          const dateStr = r.importDate ?? "";
          if (!dateStr) continue;
          const cur = byDay.get(dateStr) ?? { v1: 0, v2: 0, payment: 0 };
          if (r.logSource === "v1") cur.v1 += 1;
          else if (r.logSource === "v2") cur.v2 += 1;
          else cur.payment += 1;
          byDay.set(dateStr, cur);
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);
      byMonthFromRecords[month] = byDay;
    }

    return {
      fromMonthStats: results,
      fromPaymentRecords: Object.fromEntries(
        months.map((m) => [
          m,
          {
            daysWithV1: Array.from(byMonthFromRecords[m]?.entries() ?? [])
              .filter(([, v]) => v.v1 > 0)
              .map(([date, v]) => ({ date, ...v }))
              .sort((a, b) => a.date.localeCompare(b.date)),
            totalV1: Array.from(byMonthFromRecords[m]?.values() ?? []).reduce((s, v) => s + v.v1, 0),
          },
        ])
      ),
    };
  },
});

/**
 * Diagnóstico V1 Marzo 2025: referencias procesadas vs encontradas (sin considerar Payment).
 * - TaskStateEntered: todas las referencias que entraron al workflow
 * - TaskStateExited (output != null): referencias encontradas en DB
 * - Con y sin deduplicación
 */
export const diagnoseV1March2025ProcessedVsFound = action({
  args: {},
  handler: async (ctx) => {
    const month = "2025-03";
    const [year, mon] = month.split("-").map(Number);

    const allRefsEntered = new Set<string>();
    const allRefsFound = new Set<string>();
    let totalEventsEntered = 0;
    let totalEventsFound = 0;
    let totalRefsEnteredRaw = 0;
    let totalRefsFoundRaw = 0;

    const extractReferencias = (msgStr: string): string[] => {
      const refs: string[] = [];
      try {
        const msg = JSON.parse(msgStr) as Record<string, unknown>;
        const details = msg?.details as Record<string, unknown> | undefined;
        if (!details) return refs;

        const extractFromObj = (obj: unknown): void => {
          if (!obj || typeof obj !== "object") return;
          const r = obj as Record<string, unknown>;
          const ref = String(r?.referencia ?? "").trim();
          if (ref) refs.push(ref);
          const txns = r.transacciones ?? (r.data as Record<string, unknown> | undefined)?.transacciones ?? (r.payload as Record<string, unknown> | undefined)?.transacciones;
          if (Array.isArray(txns)) {
            for (const t of txns) {
              const tr = t as Record<string, unknown>;
              const trRef = String(tr?.referencia ?? "").trim();
              if (trRef) refs.push(trRef);
            }
          }
        };

        const inputStr = details.input;
        if (typeof inputStr === "string" && inputStr !== "null") {
          try {
            const input = JSON.parse(inputStr) as Record<string, unknown>;
            extractFromObj(input);
            const txns = input?.transacciones;
            if (Array.isArray(txns)) {
              for (const t of txns) extractFromObj(t);
            }
          } catch {
            /* ignore */
          }
        }

        const outputStr = details.output;
        if (typeof outputStr === "string" && outputStr !== "null") {
          try {
            const output = JSON.parse(outputStr) as Record<string, unknown>;
            extractFromObj(output);
            const data = (output?.data ?? output?.payload) as Record<string, unknown> | undefined;
            if (data && typeof data === "object") {
              if (Array.isArray(data.transacciones)) {
                for (const t of data.transacciones) extractFromObj(t);
              } else if (data.referencia) refs.push(String(data.referencia).trim());
            }
          } catch {
            /* ignore */
          }
          // Output puede ser JSON anidado: buscar referencia en el string
          if (refs.length === 0 && outputStr.includes("referencia")) {
            const refMatch = outputStr.match(/"referencia"\s*:\s*"(\d{15,})"/);
            if (refMatch?.[1]) refs.push(refMatch[1]);
          }
        }

        const paramsStr = details.parameters;
        if (typeof paramsStr === "string") {
          try {
            const params = JSON.parse(paramsStr) as { Payload?: Record<string, unknown> };
            if (params?.Payload?.referencia) refs.push(String(params.Payload.referencia).trim());
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      // Fallback: regex para referencias (escapadas o normales)
      if (refs.length === 0) {
        const patterns = [
          /"referencia"\s*:\s*"([^"\\]+)"/g,
          /\\"referencia\\"\s*:\s*\\"([^"\\]+)\\"/g,
          /"referencia"\s*:\s*"(\d{18,})"/g,
        ];
        for (const re of patterns) {
          const it = msgStr.matchAll(re);
          for (const m of it) {
            const r = (m[1] ?? "").replace(/\\"/g, "").trim();
            if (r && /^\d{15,}$/.test(r)) refs.push(r);
          }
          if (refs.length > 0) break;
        }
      }
      return refs;
    };

    const runQuery = async (
      queryStr: string,
      startSec: number,
      endSec: number
    ): Promise<Array<Record<string, string>>> => {
      const startRes = await client.send(
        new StartQueryCommand({
          logGroupName: LOG_GROUPS.v1,
          startTime: startSec,
          endTime: endSec,
          queryString: queryStr,
        })
      );
      if (!startRes.queryId) return [];
      let status: QueryStatus | undefined = QueryStatus.Running;
      let raw: Array<Array<{ field?: string; value?: string }>> = [];
      let attempts = 0;
      while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
        if (attempts >= 90) break;
        await new Promise((r) => setTimeout(r, 1000));
        const res = await client.send(new GetQueryResultsCommand({ queryId: startRes.queryId }));
        status = res.status;
        attempts++;
        if (status === QueryStatus.Complete) {
          raw = res.results || [];
          break;
        }
      }
      return raw.map((row) => {
        const o: Record<string, string> = {};
        for (const f of row) {
          if (f.field && f.value) o[f.field] = f.value;
        }
        return o;
      });
    };

    const qEntered = `fields @timestamp, @message
| filter @message like /Preparar Datos/ and @message like /TaskStateEntered/
| sort @timestamp desc
| limit 10000`;

    const qFound = `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit 10000`;

    // Día por día para evitar límite 10k
    const daysInMonth = new Date(year, mon, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const startUtc = new Date(Date.UTC(year, mon - 1, d, 6, 0, 0, 0));
      const endUtc = new Date(Date.UTC(year, mon - 1, d + 1, 5, 59, 59, 999));
      const startSec = Math.floor(startUtc.getTime() / 1000);
      const endSec = Math.floor(endUtc.getTime() / 1000);

      const [rowsEntered, rowsFound] = await Promise.all([
        runQuery(qEntered, startSec, endSec),
        runQuery(qFound, startSec, endSec),
      ]);

      for (const row of rowsEntered) {
        totalEventsEntered++;
        const refs = extractReferencias(row["@message"] ?? "");
        for (const ref of refs) {
          if (ref) {
            totalRefsEnteredRaw++;
            allRefsEntered.add(ref);
          }
        }
      }
      for (const row of rowsFound) {
        totalEventsFound++;
        const refs = extractReferencias(row["@message"] ?? "");
        for (const ref of refs) {
          if (ref) {
            totalRefsFoundRaw++;
            allRefsFound.add(ref);
          }
        }
      }
    }

    const limitHit = totalEventsEntered >= 10000 || totalEventsFound >= 10000;
    const refsSoloEntraronNoSalieron = [...allRefsEntered].filter((r) => !allRefsFound.has(r)).length;

    // Cruzar las 6,282 encontradas en V1 con paymentRecords: ¿están en Payment o en V1?
    const refToSource = new Map<string, "v1" | "v2" | "payment">();
    let cursor: string | undefined;
    do {
      const result = await ctx.runQuery(api.queries.getPaymentRecordsPageWithDetails, {
        month,
        cursor,
        numItems: 5000,
      });
      for (const r of result.page) {
        refToSource.set(r.referencia, r.logSource);
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    } while (cursor);

    const v1FoundEnPayment = [...allRefsFound].filter((r) => refToSource.get(r) === "payment").length;
    const v1FoundEnV1 = [...allRefsFound].filter((r) => refToSource.get(r) === "v1").length;
    const v1FoundEnV2 = [...allRefsFound].filter((r) => refToSource.get(r) === "v2").length;
    const v1FoundNoEnConvex = [...allRefsFound].filter((r) => !refToSource.has(r)).length;

    return {
      month,
      description: "V1 únicamente, sin considerar Payment",
      nota: limitHit ? "Límite CloudWatch 10000: conteos pueden estar truncados" : undefined,
      workflow: {
        referenciasEncontradas: allRefsFound.size,
        referenciasNoEncontradas: refsSoloEntraronNoSalieron,
        totalProcesadas: allRefsEntered.size,
        pctEncontradas: allRefsEntered.size > 0 ? ((allRefsFound.size / allRefsEntered.size) * 100).toFixed(1) + "%" : "N/A",
      },
      v1FoundEnConvex: {
        enPayment: v1FoundEnPayment,
        enV1: v1FoundEnV1,
        enV2: v1FoundEnV2,
        noEnConvex: v1FoundNoEnConvex,
        total: allRefsFound.size,
      },
      taskStateEntered: {
        totalEvents: totalEventsEntered,
        referenciasSinDedup: totalRefsEnteredRaw,
        referenciasConDedup: allRefsEntered.size,
      },
      taskStateExitedFound: {
        totalEvents: totalEventsFound,
        referenciasSinDedup: totalRefsFoundRaw,
        referenciasConDedup: allRefsFound.size,
      },
    };
  },
});

/**
 * Diagnóstico: compara queries V1 TaskStateEntered vs TaskStateExited para una fecha.
 * Útil para entender por qué V1 devuelve 0 pagos en marzo.
 */
export const diagnoseV1QueryVariants = action({
  args: { date: v.string() },
  handler: async (_ctx, { date }) => {
    const [y, mo, day] = date.split("-").map(Number);
    const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
    const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
    const startTimeSec = Math.floor(startUtc.getTime() / 1000);
    const endTimeSec = Math.floor(endUtc.getTime() / 1000);
    const logGroup = LOG_GROUPS.v1;

    async function runQuery(q: string): Promise<number> {
      const startRes = await client.send(
        new StartQueryCommand({
          logGroupName: logGroup,
          startTime: startTimeSec,
          endTime: endTimeSec,
          queryString: q,
        })
      );
      if (!startRes.queryId) return -1;
      let status: QueryStatus | undefined = QueryStatus.Running;
      let count = 0;
      let attempts = 0;
      while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
        if (attempts >= 30) break;
        await new Promise((r) => setTimeout(r, 1000));
        const getRes = await client.send(
          new GetQueryResultsCommand({ queryId: startRes.queryId })
        );
        status = getRes.status;
        attempts++;
        if (status === QueryStatus.Complete) {
          count = getRes.results?.length ?? 0;
          break;
        }
      }
      return count;
    }

    const qEntered = `fields @timestamp, @message
| filter @message like /Preparar Datos/ and @message like /TaskStateEntered/
| sort @timestamp desc
| limit 100`;
    const qExitedNoFilter = `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| sort @timestamp desc
| limit 100`;
    const qExitedWithFilter = `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit 100`;

    const [entered, exitedNoFilter, exitedWithFilter] = await Promise.all([
      runQuery(qEntered),
      runQuery(qExitedNoFilter),
      runQuery(qExitedWithFilter),
    ]);

    return {
      date,
      logGroup,
      taskStateEntered: entered,
      taskStateExitedNoOutputFilter: exitedNoFilter,
      taskStateExitedWithOutputFilter: exitedWithFilter,
    };
  },
});

/**
 * Diagnóstico: busca una referencia en CloudWatch (V1, V2, Payment) para ver
 * el estatus original en los logs. Útil para detectar pagos incorrectamente
 * marcados como PAGADO.
 */
type SearchReferenciaResult = {
  foundInConvex: boolean;
  convexRecord: {
    referencia: string;
    estatus: string;
    logSource: string;
    importDate?: string;
    importMonth: string;
    monto: number;
  } | null;
  error?: string;
  dateRange?: { start: string; end: string; startTimeSec: number; endTimeSec: number };
  v1: Array<{ timestamp?: string; estatus: string | null; messagePreview: string }>;
  v2: Array<{ timestamp?: string; estatus: string | null; messagePreview: string }>;
  payment: Array<{ timestamp?: string; estatus: string | null; messagePreview: string }>;
};

export const searchReferenciaInCloudWatch = action({
  args: {
    referencia: v.string(),
    /** Rango: YYYY-MM-DD. Si no se da, usa el mes completo de importDate en Convex. */
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { referencia, startDate, endDate }
  ): Promise<SearchReferenciaResult> => {
    // Si no hay fechas, buscar en Convex para obtener importDate
    let start = startDate;
    let end = endDate;
    if (!start || !end) {
      const records = (await ctx.runQuery(api.queries.searchByReferencia, {
        referencia,
      })) as Array<{
        referencia: string;
        importDate?: string;
        timestamp?: string;
        estatus?: string;
        logSource?: string;
        importMonth?: string;
        monto?: number;
      }>;
      if (records.length === 0) {
        return {
          foundInConvex: false,
          convexRecord: null,
          error: "Referencia no encontrada en Convex",
          v1: [],
          v2: [],
          payment: [],
        };
      }
      const first = records[0];
      const importDate = first.importDate ?? first.timestamp?.substring(0, 10);
      if (!importDate) {
        return {
          foundInConvex: true,
          convexRecord: {
            referencia: first.referencia,
            estatus: first.estatus ?? "",
            logSource: first.logSource ?? "",
            importDate: first.importDate,
            importMonth: first.importMonth ?? "",
            monto: first.monto ?? 0,
          },
          error: "No se pudo determinar importDate para rango CloudWatch",
          v1: [],
          v2: [],
          payment: [],
        };
      }
      const [y, m, d] = importDate.split("-").map(Number);
      start = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }

    const [sy, sm, sd] = start.split("-").map(Number);
    const [ey, em, ed] = end.split("-").map(Number);
    const startUtc = new Date(Date.UTC(sy, sm - 1, sd, 6, 0, 0, 0));
    const endUtc = new Date(Date.UTC(ey, em - 1, ed + 1, 5, 59, 59, 999));
    const startTimeSec = Math.floor(startUtc.getTime() / 1000);
    const endTimeSec = Math.floor(endUtc.getTime() / 1000);

    const v1V2Query = `fields @timestamp, @message
| filter @message like /Preparar Datos/ and @message like /TaskStateEntered/
| filter @message like /${referencia.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/
| sort @timestamp desc
| limit 20`;

    const paymentQuery = `fields @timestamp, @message
| filter @message like /${referencia.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/
| sort @timestamp desc
| limit 20`;

    async function runQuery(
      version: "v1" | "v2" | "payment"
    ): Promise<Array<Record<string, string>>> {
      const logGroup = LOG_GROUPS[version];
      const q = version === "payment" ? paymentQuery : v1V2Query;
      const startRes = await client.send(
        new StartQueryCommand({
          logGroupName: logGroup,
          startTime: startTimeSec,
          endTime: endTimeSec,
          queryString: q,
        })
      );
      if (!startRes.queryId) return [];
      let status: QueryStatus | undefined = QueryStatus.Running;
      let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
      let attempts = 0;
      while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
        if (attempts >= 30) break;
        await new Promise((r) => setTimeout(r, 1000));
        const getRes = await client.send(
          new GetQueryResultsCommand({ queryId: startRes.queryId })
        );
        status = getRes.status;
        attempts++;
        if (status === QueryStatus.Complete) {
          rawResults = getRes.results || [];
          break;
        }
      }
      return rawResults.map((row) => {
        const result: Record<string, string> = {};
        for (const f of row) {
          if (f.field && f.value) result[f.field] = f.value;
        }
        return result;
      });
    }

    const [v1Rows, v2Rows, paymentRows] = await Promise.all([
      runQuery("v1").catch((e) => {
        console.error("[v1]:", e);
        return [] as Array<Record<string, string>>;
      }),
      runQuery("v2").catch((e) => {
        console.error("[v2]:", e);
        return [] as Array<Record<string, string>>;
      }),
      runQuery("payment").catch((e) => {
        console.error("[payment]:", e);
        return [] as Array<Record<string, string>>;
      }),
    ]);

    const extractEstatus = (msg: string): string | null => {
      const m = msg.match(/"estatus"\s*:\s*"([^"]*)"/);
      if (m) return m[1];
      const m2 = msg.match(/"status"\s*:\s*"([^"]*)"/);
      if (m2) return m2[1];
      return null;
    };

    const convexRecords = (await ctx.runQuery(
      api.queries.searchByReferencia,
      { referencia }
    )) as Array<{
      referencia: string;
      estatus: string;
      logSource: string;
      importDate?: string;
      importMonth: string;
      monto: number;
    }>;

    return {
      foundInConvex: convexRecords.length > 0,
      convexRecord:
        convexRecords.length > 0
          ? {
              referencia: convexRecords[0].referencia,
              estatus: convexRecords[0].estatus,
              logSource: convexRecords[0].logSource,
              importDate: convexRecords[0].importDate,
              importMonth: convexRecords[0].importMonth,
              monto: convexRecords[0].monto,
            }
          : null,
      dateRange: { start, end, startTimeSec, endTimeSec },
      v1: v1Rows.map((r) => ({
        timestamp: r["@timestamp"],
        estatus: extractEstatus(r["@message"] ?? ""),
        messagePreview: (r["@message"] ?? "").substring(0, 500),
      })),
      v2: v2Rows.map((r) => ({
        timestamp: r["@timestamp"],
        estatus: extractEstatus(r["@message"] ?? ""),
        messagePreview: (r["@message"] ?? "").substring(0, 500),
      })),
      payment: paymentRows.map((r) => ({
        timestamp: r["@timestamp"],
        estatus: extractEstatus(r["@message"] ?? ""),
        messagePreview: (r["@message"] ?? "").substring(0, 500),
      })),
    };
  },
});

export const getReferenciasAboveMonto = action({
  args: {
    month: v.string(),
    minMonto: v.number(),
  },
  handler: async (ctx, { month, minMonto }) => {
    const results: Array<{ referencia: string; monto: number }> = [];
    let cursor: string | null = null;

    while (true) {
      const result = (await ctx.runQuery(
        api.queries.getPaymentsByMonthPaginated,
        {
          month,
          paginationOpts: { numItems: 1000, cursor },
        }
      )) as {
        page: Array<{ referencia: string; monto: number; estatus: string }>;
        isDone: boolean;
        continueCursor: string | null;
      };

      for (const r of result.page) {
        if (r.monto > minMonto && isPagado(r.estatus)) {
          results.push({ referencia: r.referencia, monto: r.monto });
        }
      }

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    results.sort((a, b) => b.monto - a.monto);
    return results;
  },
});

/** Conteo de referencias por código `fuente` en un mes. Pagina internamente. */
export const getDatamappingFuenteCountsByMonth = action({
  args: { month: v.string() },
  handler: async (ctx, { month }): Promise<Array<{ value: string; count: number }>> => {
    const byFuente = new Map<string, number>();
    let cursor: string | null = null;
    while (true) {
      const result: {
        page: Array<{ fuente?: string }>;
        isDone: boolean;
        continueCursor: string | null;
      } = await ctx.runQuery(api.queries.getDatamappingRecordsByMonthPaginated, {
        month,
        paginationOpts: { numItems: 1000, cursor },
      });
      for (const r of result.page) {
        const f = (r.fuente ?? "").trim() || "(vacío)";
        byFuente.set(f, (byFuente.get(f) ?? 0) + 1);
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    return Array.from(byFuente.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  },
});

