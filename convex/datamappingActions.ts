"use node";

import { action, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import {
  queryDatamappingPagoValidadoForDay,
  queryDatamappingPage,
  queryDatamappingPageForMonth,
  queryDatamappingPageForDay,
  mapDynamoItemToRecord,
  listFirstItemAttributes,
  extractEnrichmentFieldsFromRawJson,
} from "./lib/dynamodb";
import { fechaTransaccionToMexicoDate } from "./lib/mexicoDate";

/** Límite Convex: 600 segundos por acción. */
const ACTION_TIME_LIMIT_MS = 550_000;

/** Si el error es una respuesta HTML (500/524 de Cloudflare), devuelve un mensaje corto para reintento. */
function sanitizeConvexResponseError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.startsWith("<!DOCTYPE") ||
    msg.startsWith("<html") ||
    (msg.includes("500") && msg.includes("Internal server error"))
  ) {
    return new Error("Error 500 del servidor (Cloudflare/Convex). Reintentar en unos segundos.");
  }
  if (msg.includes("524") || msg.toLowerCase().includes("timeout")) {
    return new Error("Timeout (524). Reintentar.");
  }
  return err instanceof Error ? err : new Error(msg);
}

const DATAMAPPING_INGEST_BATCH = 150;
/** Límite Convex por acción. Procesamos hasta este número de registros por llamada. */
const MAX_ITEMS_PER_ACTION = 4000;

type BaseDatamappingRec = ReturnType<typeof mapDynamoItemToRecord>;
/** Añade enriquecimiento (RFC, placa, status, fuente, etc.) desde rawJson y marca enrichmentExtracted: true para la carga. */
function withEnrichment(rec: BaseDatamappingRec): BaseDatamappingRec & {
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
  enrichmentExtracted: true;
} {
  const fields = extractEnrichmentFieldsFromRawJson(rec.rawJson);
  const out: BaseDatamappingRec & {
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
    enrichmentExtracted: true;
  } = {
    ...rec,
    rfc: fields.rfc ?? "",
    enrichmentExtracted: true as const,
  };
  if (fields.placa) out.placa = fields.placa;
  if (fields.evoId) out.evoId = fields.evoId;
  if (fields.codiId) out.codiId = fields.codiId;
  if (fields.expirationDate) out.expirationDate = fields.expirationDate;
  if (fields.folioNumber) out.folioNumber = fields.folioNumber;
  if (fields.loteId) out.loteId = fields.loteId;
  if (fields.procedureCategory) out.procedureCategory = fields.procedureCategory;
  if (fields.tramiteId) out.tramiteId = fields.tramiteId;
  if (fields.userId) out.userId = fields.userId;
  if (fields.status !== undefined && fields.status !== "") out.status = fields.status;
  else if (rec.status) out.status = rec.status;
  if (fields.fuente !== undefined && fields.fuente !== "") out.fuente = fields.fuente;
  else if (rec.fuente) out.fuente = rec.fuente;
  return out;
}

/** Construye rango updatedAt para enriquecimiento (todos los registros con enrichmentExtracted false). */
function getEnrichmentDateRange(
  fromDate: string,
  toDate: string | undefined
): { updatedAtFrom: string; updatedAtTo: string } {
  const updatedAtFrom = fromDate.includes("T") ? fromDate : `${fromDate}T00:00:00.000Z`;
  const to = toDate ?? new Date().toISOString().slice(0, 10);
  const [y, m, d] = to.includes("T") ? to.slice(0, 10).split("-").map(Number) : to.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const updatedAtTo = nextDay.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  return { updatedAtFrom, updatedAtTo };
}

type RfcEnrichmentRunId = import("./_generated/dataModel").Id<"rfcEnrichmentRuns">;

async function updateEnrichmentRun(
  ctx: ActionCtx,
  runId: RfcEnrichmentRunId | undefined,
  payload: {
    status: "completed" | "timed_out" | "error";
    processed?: number;
    enriched?: number;
    message?: string;
    continueState?:
      | { tipoMovIndex: number; cursor: string | null; tipoMovOrder: string[] }
      | { cursor: string | null; updatedAtFrom: string; updatedAtTo: string };
  }
): Promise<void> {
  if (!runId) return;
  await ctx.runMutation(api.datamappingMutations.updateRfcEnrichmentRun, { runId, ...payload });
}

/** Margen para backfill: detenerse antes del límite 600s de Convex (500s = 100s margen). */
const BACKFILL_TIME_LIMIT_MS = 500_000;

/** Límite por llamada para Inngest (evitar timeout 524 del proxy). */
const BACKFILL_FOR_RANGE_MAX_MS = 85_000;

/** Límite de tiempo para backfill fechaTransaccion por rango (cada step de Inngest). */
const FECHA_TRANSACCION_BACKFILL_MAX_MS = 85_000;

/** Fin de rango universo datamapping para consultas. */
const DATAMAPPING_UNIVERSE_END = "2031-01-01T00:00:00.000Z";

/** Rango amplio para backfill fechaTransaccionMexico (registros con fechaTransaccion). */
const FECHA_TRANSACCION_MEXICO_BACKFILL_RANGE = {
  from: "2020-01-01",
  to: "2030-01-01",
};

/** Considera PAGO VALIDADO si status es PAGO VALIDADO, PAGADO o PA (alineado con parsers). */
function isPagoValidadoStatus(status: string | undefined): boolean {
  const s = (status ?? "").trim().toUpperCase();
  return s === "PAGO VALIDADO" || s === "PAGADO" || s === "PA";
}

/** Declaraciones en cero: fuente DEC (case-insensitive). */
function isDecFuente(fuente: string | undefined): boolean {
  return (fuente ?? "").trim().toUpperCase() === "DEC";
}

/** Carga DynamoDB → Convex por lotes (incluye enriquecimiento: RFC, placa, etc. en un solo paso).
 * Si toDate se pasa, solo se cargan registros con updatedAt en [sinceDate, toDate] (por día). */
export const fetchDatamappingAndIngest = action({
  args: {
    sinceDate: v.string(),
    toDate: v.optional(v.string()),
    exclusiveStartKey: v.optional(v.string()),
  },
  handler: async (ctx, { sinceDate, toDate, exclusiveStartKey }) => {
    type DatamappingRec = ReturnType<typeof mapDynamoItemToRecord> & {
      rfc?: string;
      placa?: string;
      evoId?: string;
      codiId?: string;
      expirationDate?: string;
      folioNumber?: string;
      loteId?: string;
      procedureCategory?: string;
      tramiteId?: string;
      userId?: string;
      enrichmentExtracted?: true;
    };
    const records: DatamappingRec[] = [];
    let cursor: string | undefined = exclusiveStartKey;
    while (records.length < MAX_ITEMS_PER_ACTION) {
      const { items, lastEvaluatedKey } = await queryDatamappingPage(
        sinceDate,
        cursor,
        toDate
      );
      for (const item of items) {
        const rec = mapDynamoItemToRecord(item as Record<string, unknown>);
        records.push(withEnrichment(rec) as DatamappingRec);
        if (records.length >= MAX_ITEMS_PER_ACTION) break;
      }
      cursor = lastEvaluatedKey ?? undefined;
      if (!cursor) break;
    }
    const byDate: Record<string, number> = {};
    for (const rec of records) {
      const d = rec.updatedAt?.slice(0, 10) ?? "";
      if (d.length >= 10) byDate[d] = (byDate[d] ?? 0) + 1;
    }
    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < records.length; i += DATAMAPPING_INGEST_BATCH) {
      const batch = records.slice(i, i + DATAMAPPING_INGEST_BATCH);
      const result = (await ctx.runMutation(
        api.datamappingMutations.upsertDatamappingBatch,
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
      byDate,
    };
  },
});

const DATAMAPPING_PROGRESS_LOG_EVERY_BATCHES = 5;

/** Extrae un solo día de DynamoDB (updatedAt en ese día) y upserta en datamappingRecords (con enriquecimiento).
 *  Incluye logging para diagnóstico (Convex Console) y campos de diagnóstico para Audit (durationMs, batchCount, etc.).
 *  Sin límite de tiempo interno (no hay chequeo legacy de 5 min; el único límite es el de Convex, 600s por action). */
export const fetchDatamappingForDay = action({
  args: {
    year: v.number(),
    month: v.number(),
    day: v.number(),
  },
  handler: async (ctx, { year, month, day }) => {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const startedAt = Date.now();
    let inserted = 0;
    let updated = 0;
    let batchCount = 0;
    type DatamappingRec = ReturnType<typeof mapDynamoItemToRecord> & {
      rfc?: string;
      placa?: string;
      evoId?: string;
      codiId?: string;
      expirationDate?: string;
      folioNumber?: string;
      loteId?: string;
      procedureCategory?: string;
      tramiteId?: string;
      userId?: string;
      enrichmentExtracted?: true;
    };
    const batch: DatamappingRec[] = [];

    const durationMs = (): number => Date.now() - startedAt;

    console.log("[datamapping] fetchDatamappingForDay start", {
      date: dateStr,
      year,
      month,
      day,
    });

    try {
      let maxUpdatedAt = "";
      for await (const item of queryDatamappingPagoValidadoForDay(
        year,
        month,
        day
      )) {
        const rec = mapDynamoItemToRecord(item as Record<string, unknown>);
        if (rec.updatedAt > maxUpdatedAt) maxUpdatedAt = rec.updatedAt;
        batch.push(withEnrichment(rec) as DatamappingRec);
        if (batch.length >= DATAMAPPING_INGEST_BATCH) {
          const result = (await ctx.runMutation(
            api.datamappingMutations.upsertDatamappingBatch,
            { records: batch, skipStatsUpdate: true }
          )) as { inserted: number; updated: number };
          inserted += result.inserted;
          updated += result.updated;
          batchCount += 1;
          batch.length = 0;
          if (batchCount % DATAMAPPING_PROGRESS_LOG_EVERY_BATCHES === 0) {
            console.log("[datamapping] fetchDatamappingForDay progress", {
              date: dateStr,
              batchCount,
              inserted,
              updated,
              elapsedMs: durationMs(),
            });
          }
        }
      }
      if (batch.length > 0) {
        const result = (await ctx.runMutation(
          api.datamappingMutations.upsertDatamappingBatch,
          { records: batch, skipStatsUpdate: true }
        )) as { inserted: number; updated: number };
        inserted += result.inserted;
        updated += result.updated;
        batchCount += 1;
      }

      const ms = durationMs();
      console.log("[datamapping] fetchDatamappingForDay completed", {
        date: dateStr,
        durationMs: ms,
        inserted,
        updated,
        batchCount,
      });
      return {
        inserted,
        updated,
        batchCount,
        day,
        maxUpdatedAt: maxUpdatedAt || null,
        durationMs: ms,
      };
    } catch (err) {
      const ms = durationMs();
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[datamapping] fetchDatamappingForDay failed", {
        date: dateStr,
        durationMs: ms,
        inserted,
        updated,
        batchCount,
        error: errorMessage,
      });
      return {
        error: errorMessage,
        inserted,
        updated,
        batchCount,
        durationMs: ms,
      };
    }
  },
});

/**
 * Procesa un chunk (una página) de un día de DynamoDB.
 * Para evitar 524/600s: cada llamada hace 1 página DynamoDB + ~7 batches de upsert.
 * El caller (Inngest) hace un bucle hasta hasMore=false.
 */
export const fetchDatamappingForDayChunk = action({
  args: {
    year: v.number(),
    month: v.number(),
    day: v.number(),
    exclusiveStartKey: v.optional(v.string()),
  },
  handler: async (ctx, { year, month, day, exclusiveStartKey }) => {
    let inserted = 0;
    let updated = 0;
    let maxUpdatedAt = "";
    type DatamappingRec = {
      transactionId: string;
      referencia: string;
      monto: number;
      fechaPago?: string;
      fuente?: string;
      urlPago?: string;
      tipoMovimiento?: string;
      updatedAt: string;
      rawJson: string;
    };

    const { items, lastEvaluatedKey } = await queryDatamappingPageForDay(
      year,
      month,
      day,
      exclusiveStartKey
    );

    const records: DatamappingRec[] = items.map((item) =>
      withEnrichment(mapDynamoItemToRecord(item as Record<string, unknown>)) as DatamappingRec
    );
    for (const rec of records) {
      if (rec.updatedAt > maxUpdatedAt) maxUpdatedAt = rec.updatedAt;
    }

    for (let i = 0; i < records.length; i += DATAMAPPING_INGEST_BATCH) {
      const batch = records.slice(i, i + DATAMAPPING_INGEST_BATCH);
      const result = (await ctx.runMutation(
        api.datamappingMutations.upsertDatamappingBatch,
        { records: batch, skipStatsUpdate: true }
      )) as { inserted: number; updated: number };
      inserted += result.inserted;
      updated += result.updated;
    }

    return {
      inserted,
      updated,
      hasMore: lastEvaluatedKey != null,
      exclusiveStartKey: lastEvaluatedKey ?? null,
      maxUpdatedAt: maxUpdatedAt || null,
    };
  },
});

/** Extrae un mes completo de DynamoDB (updatedAt en ese mes) y upserta en datamappingRecords. Para carga histórica: 1 job por mes. */
export const fetchDatamappingForMonth = action({
  args: {
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, { year, month }) => {
    let inserted = 0;
    let updated = 0;
    let maxUpdatedAt = "";
    let cursor: string | undefined;
    do {
      const { items, lastEvaluatedKey } = await queryDatamappingPageForMonth(
        year,
        month,
        cursor
      );
      for (let i = 0; i < items.length; i += DATAMAPPING_INGEST_BATCH) {
        const batch = items
          .slice(i, i + DATAMAPPING_INGEST_BATCH)
          .map((item) =>
            withEnrichment(mapDynamoItemToRecord(item as Record<string, unknown>))
          );
        for (const rec of batch) {
          if (rec.updatedAt > maxUpdatedAt) maxUpdatedAt = rec.updatedAt;
        }
        const result = (await ctx.runMutation(
          api.datamappingMutations.upsertDatamappingBatch,
          { records: batch, skipStatsUpdate: true }
        )) as { inserted: number; updated: number };
        inserted += result.inserted;
        updated += result.updated;
      }
      cursor = lastEvaluatedKey ?? undefined;
    } while (cursor);
    return { inserted, updated, year, month, maxUpdatedAt: maxUpdatedAt || null };
  },
});

/** Extracción incremental: desde la última marca de agua (updatedAt). Para ejecución periódica (cada hora/5 min). Si no hay marca, retorna sin procesar (ejecutar histórico primero). */
export const fetchDatamappingIncremental = action({
  args: {},
  handler: async (
    ctx: ActionCtx
  ): Promise<{
    inserted: number;
    updated: number;
    processed: number;
    newWatermark: string | null;
    message?: string;
  }> => {
    const watermarkDoc = await ctx.runQuery(
      api.datamappingQueries.getDatamappingWatermark,
      {}
    );
    const sinceDate = watermarkDoc?.lastUpdatedAt;
    if (!sinceDate) {
      return {
        inserted: 0,
        updated: 0,
        processed: 0,
        newWatermark: null,
        message: "No hay marca de agua. Ejecutar histórico completo primero.",
      };
    }
    const records: Array<ReturnType<typeof mapDynamoItemToRecord> & { rfc?: string; placa?: string; evoId?: string; codiId?: string; expirationDate?: string; folioNumber?: string; loteId?: string; procedureCategory?: string; tramiteId?: string; userId?: string; enrichmentExtracted?: true }> = [];
    let cursor: string | undefined;
    let maxUpdatedAt = sinceDate;

    do {
      const { items, lastEvaluatedKey } = await queryDatamappingPage(
        sinceDate,
        cursor
      );
      for (const item of items) {
        const rec = mapDynamoItemToRecord(item as Record<string, unknown>);
        const enriched = withEnrichment(rec);
        records.push(enriched);
        if (rec.updatedAt > maxUpdatedAt) maxUpdatedAt = rec.updatedAt;
      }
      if (records.length >= MAX_ITEMS_PER_ACTION) break;
      cursor = lastEvaluatedKey ?? undefined;
    } while (cursor);

    let totalInserted = 0;
    let totalUpdated = 0;
    for (let i = 0; i < records.length; i += DATAMAPPING_INGEST_BATCH) {
      const batch = records.slice(i, i + DATAMAPPING_INGEST_BATCH);
      const result = (await ctx.runMutation(
        api.datamappingMutations.upsertDatamappingBatch,
        { records: batch }
      )) as { inserted: number; updated: number };
      totalInserted += result.inserted;
      totalUpdated += result.updated;
    }

    if (records.length > 0 && maxUpdatedAt !== sinceDate) {
      await ctx.runMutation(api.datamappingMutations.setDatamappingWatermark, {
        lastUpdatedAt: maxUpdatedAt,
      });
    }

    return {
      inserted: totalInserted,
      updated: totalUpdated,
      processed: records.length,
      newWatermark: records.length > 0 ? maxUpdatedAt : sinceDate,
    };
  },
});

/** Explora DynamoDB: devuelve las keys del primer item con updatedAt > sinceDate (para confirmar nombres de atributos). */
export const exploreDatamappingAttributes = action({
  args: { sinceDate: v.string() },
  handler: async (_ctx, { sinceDate }) => {
    return listFirstItemAttributes(sinceDate);
  },
});

const DEFAULT_PENDING_COUNT_MAX_PER_MONTH = 100_000;
const DEFAULT_PENDING_COUNT_MAX_MS = 30_000;

/**
 * Cuenta registros con enrichmentExtracted === false por mes (pagina con el índice).
 * Útil para "Calcular pendientes" antes de lanzar enriquecimiento. Opcional tope por mes y por tiempo.
 */
export const getPendingEnrichmentCountByMonths = action({
  args: {
    months: v.array(v.string()),
    maxCountPerMonth: v.optional(v.number()),
    maxDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxCountPerMonth = args.maxCountPerMonth ?? DEFAULT_PENDING_COUNT_MAX_PER_MONTH;
    const maxDurationMs = args.maxDurationMs ?? DEFAULT_PENDING_COUNT_MAX_MS;
    const startMs = Date.now();
    const counts: Record<string, number> = {};
    const truncated: string[] = [];
    const PAGE = 500;

    for (const month of args.months) {
      const [y, m] = month.split("-").map(Number);
      if (!y || !m) {
        counts[month] = 0;
        continue;
      }
      const updatedAtFrom = `${month}-01T00:00:00.000Z`;
      const nextMonth =
        m === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
      const updatedAtTo = nextMonth.toISOString().replace(/\.\d{3}Z$/, ".000Z");

      let count = 0;
      let cursor: string | null = null;
      while (count < maxCountPerMonth) {
        if (Date.now() - startMs > maxDurationMs) break;
        const result = (await ctx.runQuery(
          api.datamappingQueries.getDatamappingIdsNeedingEnrichment,
          {
            updatedAtFrom,
            updatedAtTo,
            cursor,
            numItems: PAGE,
          }
        )) as {
          page: { _id: unknown }[];
          isDone: boolean;
          continueCursor: string | null;
        };
        count += result.page.length;
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      counts[month] = count;
      if (count >= maxCountPerMonth) truncated.push(month);
    }
    return {
      counts,
      ...(truncated.length > 0 ? { truncated } : {}),
    };
  },
});

/**
 * Enriquecer datamappingRecords: extrae RFC + placa, evoId, etc. de rawJson (según existan).
 * Procesa todos los registros con enrichmentExtracted === false (sin filtrar por tipo de movimiento).
 * Marca enrichmentExtracted: true para no reprocesar salvo rerun explícito. Resumible con continueState.
 */
export const enrichDatamappingWithRfc = action({
  args: {
    fromDate: v.string(),
    toDate: v.optional(v.string()),
    /** Ignorado: se procesan todos los registros pendientes en el rango. Mantenido por compatibilidad. */
    movementCodesWithRfc: v.optional(v.array(v.string())),
    /** Para reanudar; lo devuelve la acción al hacer timeout. Acepta formato nuevo { cursor, updatedAtFrom, updatedAtTo } o legacy { tipoMovIndex, cursor, tipoMovOrder }. */
    continueState: v.optional(v.union(
      v.object({
        cursor: v.union(v.string(), v.null()),
        updatedAtFrom: v.string(),
        updatedAtTo: v.string(),
      }),
      v.object({
        tipoMovIndex: v.number(),
        cursor: v.union(v.string(), v.null()),
        tipoMovOrder: v.array(v.string()),
      })
    )),
    runId: v.optional(v.id("rfcEnrichmentRuns")),
    maxDurationMs: v.optional(v.number()),
    /** Si se pasa (ej. desde pipeline), se comprueba cancelación al inicio de cada ronda para parar antes. */
    jobId: v.optional(v.id("pipelineJobs")),
  },
  handler: async (ctx, { fromDate, toDate, continueState, runId, maxDurationMs, jobId }) => {
    const startMs = Date.now();
    const timeLimitMs = maxDurationMs ?? ACTION_TIME_LIMIT_MS;
    let processed = 0;
    let enriched = 0;
    try {
      const hasNewState =
        continueState != null &&
        "updatedAtFrom" in continueState &&
        "updatedAtTo" in continueState;
      const { updatedAtFrom, updatedAtTo } = hasNewState
        ? { updatedAtFrom: continueState.updatedAtFrom, updatedAtTo: continueState.updatedAtTo }
        : getEnrichmentDateRange(fromDate, toDate);

      /** Páginas más pequeñas = menos rawJson por vuelta; más vueltas por ventana 85s y menos timeout. */
      const ENRICHMENT_PAGE_SIZE = 50;
      const PATCH_BATCH = 50;
      type Id = import("./_generated/dataModel").Id<"datamappingRecords">;
      type PageRec = { _id: Id; rawJson: string };

      let cursor: string | null = continueState?.cursor ?? null;

      do {
        if (jobId != null) {
          const job = await ctx.runQuery(api.pipelineQueries.getPipelineJob, { jobId });
          if (job?.status === "cancelled") {
            return {
              processed,
              enriched,
              cancelled: true,
              isDone: false,
              continueState: { cursor, updatedAtFrom, updatedAtTo },
            };
          }
        }
        if (Date.now() - startMs > timeLimitMs) {
          const message =
            "Límite de tiempo alcanzado. Vuelve a ejecutar con el mismo rango para continuar (se reanudará donde quedó).";
          const continueStateOut = { cursor, updatedAtFrom, updatedAtTo };
          await updateEnrichmentRun(ctx, runId, {
            status: "timed_out",
            processed,
            enriched,
            message,
            continueState: continueStateOut,
          });
          return {
            processed,
            enriched,
            timedOut: true,
            message,
            continueState: continueStateOut,
            isDone: false,
          };
        }

        let result: {
          page: PageRec[];
          isDone: boolean;
          continueCursor: string | null;
        };
        try {
          result = (await ctx.runQuery(
            api.datamappingQueries.getDatamappingPageWithRawJsonNeedingEnrichment,
            {
              updatedAtFrom,
              updatedAtTo,
              cursor,
              numItems: ENRICHMENT_PAGE_SIZE,
            }
          )) as typeof result;
        } catch (e) {
          throw sanitizeConvexResponseError(e);
        }

        const batch: Array<{
          id: Id;
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
        }> = [];
        for (const rec of result.page) {
          processed += 1;
          const fields = extractEnrichmentFieldsFromRawJson(rec.rawJson);
          if (fields.rfc) enriched += 1;
          const update: { id: Id; rfc: string; [k: string]: string | Id | undefined } = {
            id: rec._id,
            rfc: fields.rfc,
          };
          const optionalKeys = [
            "placa",
            "evoId",
            "codiId",
            "expirationDate",
            "folioNumber",
            "loteId",
            "procedureCategory",
            "tramiteId",
            "userId",
            "status",
            "fuente",
          ] as const;
          for (const k of optionalKeys) {
            const val = fields[k];
            if (val !== undefined && val !== "") update[k] = val;
          }
          batch.push(update);
        }
        if (batch.length > 0) {
          for (let j = 0; j < batch.length; j += PATCH_BATCH) {
            const chunk = batch.slice(j, j + PATCH_BATCH);
            await ctx.runMutation(api.datamappingMutations.patchDatamappingRfcBatch, { updates: chunk });
          }
        }

        cursor = result.continueCursor;
      } while (cursor);

      await updateEnrichmentRun(ctx, runId, {
        status: "completed",
        processed,
        enriched,
      });
      return {
        processed,
        enriched,
        isDone: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateEnrichmentRun(ctx, runId, {
        status: "error",
        processed,
        enriched,
        message,
      });
      throw err;
    }
  },
});

/**
 * Backfill por rango updatedAt: marca enrichmentExtracted: false y elimina rfcExtracted.
 * Para usar desde Inngest por mes (un step por mes en paralelo). Devuelve isDone cuando el rango está completo.
 */
export const backfillDatamappingEnrichmentExtractedForRange = action({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    maxDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor: startCursor, maxDurationMs: maxMs }) => {
    const startMs = Date.now();
    const limitMs = maxMs ?? BACKFILL_FOR_RANGE_MAX_MS;
    /** Lotes de 100 para que la mutation termine en <1s (límite Convex) y no devuelva 500. */
    const BATCH = 100;
    let cursor: string | null = startCursor ?? null;
    let total = 0;

    try {
      do {
        if (Date.now() - startMs > limitMs) {
          return {
            total,
            cursor,
            timedOut: true,
            isDone: false,
            message: "Límite de tiempo. Inngest reanudará con el cursor.",
          };
        }

        let result: { page: Array<{ _id: unknown }>; continueCursor: string | null };
        try {
          result = (await ctx.runQuery(
            api.datamappingQueries.getDatamappingPageIdForBackfillByRange,
            { updatedAtFrom, updatedAtTo, cursor, numItems: BATCH }
          )) as { page: Array<{ _id: unknown }>; continueCursor: string | null };
        } catch (e) {
          throw sanitizeConvexResponseError(e);
        }

        const updates = result.page.map((r) => ({
          id: r._id as import("./_generated/dataModel").Id<"datamappingRecords">,
          enrichmentExtracted: false,
        }));
        if (updates.length > 0) {
          try {
            await ctx.runMutation(api.datamappingMutations.backfillDatamappingEnrichmentExtractedBatch, {
              updates,
            });
          } catch (e) {
            throw sanitizeConvexResponseError(e);
          }
          total += updates.length;
        }
        cursor = result.continueCursor;
      } while (cursor);

      return { total, cursor: null, timedOut: false, isDone: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Backfill enrichmentExtracted (rango): ${message}`);
    }
  },
});

/**
 * Backfill fechaTransaccion por mes: procesa registros con updatedAt en el rango del mes.
 * Lookup en paymentRecords por referencia (prioriza monto coincidente); fallback a updatedAt.
 * Para Inngest: un step por mes en paralelo; bucle con continueState hasta isDone.
 */
export const backfillFechaTransaccionForMonth = action({
  args: {
    year: v.number(),
    month: v.number(),
    continueState: v.optional(
      v.object({
        cursor: v.union(v.string(), v.null()),
      })
    ),
    maxDurationMs: v.optional(v.number()),
    jobId: v.optional(v.id("pipelineJobs")),
  },
  handler: async (ctx, { year, month, continueState, maxDurationMs: maxMs, jobId }) => {
    const startMs = Date.now();
    const limitMs = maxMs ?? FECHA_TRANSACCION_BACKFILL_MAX_MS;
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const updatedAtFrom = `${ym}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const updatedAtTo = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

    type Id = import("./_generated/dataModel").Id<"datamappingRecords">;
    let cursor: string | null = continueState?.cursor ?? null;
    let processed = 0;
    let updated = 0;

    try {
      do {
        if (jobId != null) {
          const job = await ctx.runQuery(api.pipelineQueries.getPipelineJob, { jobId });
          if (job?.status === "cancelled") throw new Error("Job cancelled");
        }
        if (Date.now() - startMs > limitMs) {
          return {
            processed,
            updated,
            isDone: false,
            continueState: { cursor },
            timedOut: true,
          };
        }

        let result: {
          page: Array<{ _id: Id; referencia: string; monto: number; updatedAt: string }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        try {
          result = (await ctx.runQuery(
            api.datamappingQueries.getDatamappingPageForFechaTransaccionBackfill,
            { updatedAtFrom, updatedAtTo, cursor, numItems: 200 }
          )) as typeof result;
        } catch (e) {
          throw sanitizeConvexResponseError(e);
        }

        if (result.page.length === 0) {
          cursor = result.continueCursor;
          if (result.isDone) break;
          continue;
        }

        const lookup = (await ctx.runQuery(
          api.cloudwatchQueries.getFechaTransaccionForReferencias,
          { referencias: result.page.map((r) => ({ referencia: r.referencia, monto: r.monto })) }
        )) as Record<string, string>;

        const updates: Array<{ id: Id; fechaTransaccion: string }> = [];
        for (const r of result.page) {
          processed += 1;
          const fechaTransaccion = lookup[r.referencia] ?? r.updatedAt;
          updates.push({ id: r._id, fechaTransaccion });
        }

        if (updates.length > 0) {
          await ctx.runMutation(api.datamappingMutations.patchDatamappingFechaTransaccionBatch, {
            updates,
          });
          updated += updates.length;
        }

        cursor = result.continueCursor;
      } while (cursor);

      return {
        processed,
        updated,
        isDone: true,
        continueState: undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Backfill fechaTransaccion (mes ${ym}): ${message}`);
    }
  },
});

/**
 * Backfill fechaTransaccion desde una fecha: procesa registros con updatedAt >= sinceDate.
 * Si toDate está definido, procesa solo hasta ese día (inclusive); si no, hasta DATAMAPPING_UNIVERSE_END.
 * Lookup en paymentRecords por referencia (prioriza monto coincidente); fallback a updatedAt.
 */
export const backfillFechaTransaccionForDatamapping = action({
  args: {
    sinceDate: v.string(),
    toDate: v.optional(v.string()),
    continueState: v.optional(
      v.object({
        cursor: v.union(v.string(), v.null()),
      })
    ),
    maxDurationMs: v.optional(v.number()),
    jobId: v.optional(v.id("pipelineJobs")),
  },
  handler: async (ctx, { sinceDate, toDate, continueState, maxDurationMs: maxMs, jobId }) => {
    const startMs = Date.now();
    const limitMs = maxMs ?? FECHA_TRANSACCION_BACKFILL_MAX_MS;
    const updatedAtFrom = sinceDate.includes("T") ? sinceDate : `${sinceDate}T00:00:00.000Z`;
    const updatedAtTo = (() => {
      if (toDate == null || toDate === "") return DATAMAPPING_UNIVERSE_END;
      const [y, m, d] = toDate.slice(0, 10).split("-").map(Number);
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
      return nextDay.toISOString().replace(/\.\d{3}Z$/, ".000Z");
    })();

    type Id = import("./_generated/dataModel").Id<"datamappingRecords">;
    let cursor: string | null = continueState?.cursor ?? null;
    let processed = 0;
    let updated = 0;

    try {
      do {
        if (jobId != null) {
          const job = await ctx.runQuery(api.pipelineQueries.getPipelineJob, { jobId });
          if (job?.status === "cancelled") throw new Error("Job cancelled");
        }
        if (Date.now() - startMs > limitMs) {
          return {
            processed,
            updated,
            isDone: false,
            continueState: { cursor },
            timedOut: true,
          };
        }

        let result: {
          page: Array<{ _id: Id; referencia: string; monto: number; updatedAt: string }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        try {
          result = (await ctx.runQuery(
            api.datamappingQueries.getDatamappingPageForFechaTransaccionBackfill,
            { updatedAtFrom, updatedAtTo, cursor, numItems: 200 }
          )) as typeof result;
        } catch (e) {
          throw sanitizeConvexResponseError(e);
        }

        if (result.page.length === 0) {
          cursor = result.continueCursor;
          if (result.isDone) break;
          continue;
        }

        const lookup = (await ctx.runQuery(
          api.cloudwatchQueries.getFechaTransaccionForReferencias,
          { referencias: result.page.map((r) => ({ referencia: r.referencia, monto: r.monto })) }
        )) as Record<string, string>;

        const updates: Array<{ id: Id; fechaTransaccion: string }> = [];
        for (const r of result.page) {
          processed += 1;
          const fechaTransaccion = lookup[r.referencia] ?? r.updatedAt;
          updates.push({ id: r._id, fechaTransaccion });
        }

        if (updates.length > 0) {
          await ctx.runMutation(api.datamappingMutations.patchDatamappingFechaTransaccionBatch, {
            updates,
          });
          updated += updates.length;
        }

        cursor = result.continueCursor;
      } while (cursor);

      return {
        processed,
        updated,
        isDone: true,
        continueState: undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Backfill fechaTransaccion (desde ${sinceDate}): ${message}`);
    }
  },
});

/**
 * Backfill fechaTransaccionMexico: establece fechaTransaccionMexico (YYYY-MM-DD hora México UTC-6)
 * a partir de fechaTransaccion para todos los registros PAGO VALIDADO que tengan fechaTransaccion.
 * Ejecutar una vez tras desplegar el índice by_status_fechaTransaccionMexico para que los tableros
 * y agregados DataMapping filtren por mes en hora México de forma consistente.
 */
export const backfillFechaTransaccionMexicoForDatamapping = action({
  args: {
    continueState: v.optional(
      v.object({
        cursor: v.union(v.string(), v.null()),
      })
    ),
    maxDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, { continueState, maxDurationMs: maxMs }) => {
    const limitMs = maxMs ?? 90_000;
    const startMs = Date.now();
    type Id = import("./_generated/dataModel").Id<"datamappingRecords">;
    let cursor: string | null = continueState?.cursor ?? null;
    let processed = 0;
    let patched = 0;

    const { from, to } = FECHA_TRANSACCION_MEXICO_BACKFILL_RANGE;
    do {
      if (Date.now() - startMs > limitMs) {
        return {
          processed,
          patched,
          isDone: false,
          continueState: { cursor },
          timedOut: true,
        };
      }

      const result = (await ctx.runQuery(
        api.datamappingQueries.getDatamappingPageForFechaTransaccionMexicoBackfill,
        { fechaTransaccionFrom: from, fechaTransaccionTo: to, cursor, numItems: 400 }
      )) as {
        page: Array<{ _id: Id; fechaTransaccion: string }>;
        isDone: boolean;
        continueCursor: string | null;
      };

      const updates: Array<{ id: Id; fechaTransaccionMexico: string }> = [];
      for (const r of result.page) {
        processed += 1;
        const fechaTransaccionMexico = fechaTransaccionToMexicoDate(r.fechaTransaccion);
        if (fechaTransaccionMexico) {
          updates.push({ id: r._id, fechaTransaccionMexico });
        }
      }

      if (updates.length > 0) {
        await ctx.runMutation(api.datamappingMutations.patchDatamappingFechaTransaccionMexicoBatch, {
          updates,
        });
        patched += updates.length;
      }

      cursor = result.continueCursor;
      if (result.isDone) break;
    } while (cursor);

    return {
      processed,
      patched,
      isDone: true,
      continueState: undefined,
    };
  },
});

/**
 * Ejecuta la investigación RFC (rango: 1 enero a hoy), guarda resultados en rfcInvestigationResults.
 */
export const runRfcInvestigationAndSave = action({
  args: {
    rfcs: v.array(v.string()),
  },
  handler: async (ctx, { rfcs }) => {
    const fromDate = "2026-01-01";
    const today = new Date();
    const toDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const matches = (await ctx.runQuery(api.datamappingQueries.getDatamappingRecordsByRfcs, {
      rfcs,
      fromDate,
      toDate,
    })) as Array<{
      rfc: string;
      referencia: string;
      monto: number;
      updatedAt: string;
      tipoMovimiento?: string;
      fuente?: string;
      status?: string;
      loteId?: string;
      tramiteId?: string;
      reciboPagoUrl?: string;
      endMonth?: string;
      declarationType?: string;
    }>;

    await ctx.runMutation(api.datamappingMutations.insertRfcInvestigationResults, {
      fromDate,
      toDate,
      matchCount: matches.length,
      matches,
    });

    return { matchCount: matches.length, fromDate, toDate };
  },
});

/** Construye y persiste datamappingMonthStats a partir de byDay (y opcional byDayPagoValidado, byDayPagoValidadoDec). */
async function recreateAllDatamappingMonthStatsFromRecordsInternal(
  ctx: ActionCtx,
  byDay: Map<string, number>,
  byDayPagoValidado?: Map<string, number>,
  byDayPagoValidadoDec?: Map<string, number>
): Promise<void> {
  const byMonthByDate = new Map<string, Map<string, number>>();
  for (const [dateStr, count] of byDay) {
    if (dateStr.length < 10) continue;
    const monthStr = dateStr.slice(0, 7);
    let dayMap = byMonthByDate.get(monthStr);
    if (!dayMap) {
      dayMap = new Map<string, number>();
      byMonthByDate.set(monthStr, dayMap);
    }
    dayMap.set(dateStr, count);
  }
  const byMonthPagoValidado = new Map<string, number>();
  if (byDayPagoValidado) {
    for (const [dateStr, count] of byDayPagoValidado) {
      if (dateStr.length < 10) continue;
      const monthStr = dateStr.slice(0, 7);
      byMonthPagoValidado.set(monthStr, (byMonthPagoValidado.get(monthStr) ?? 0) + count);
    }
  }
  const byMonthPagoValidadoDec = new Map<string, number>();
  if (byDayPagoValidadoDec) {
    for (const [dateStr, count] of byDayPagoValidadoDec) {
      if (dateStr.length < 10) continue;
      const monthStr = dateStr.slice(0, 7);
      byMonthPagoValidadoDec.set(monthStr, (byMonthPagoValidadoDec.get(monthStr) ?? 0) + count);
    }
  }
  const months = Array.from(byMonthByDate.entries()).map(([month, dayMap]) => {
    const byDate = Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const totalRecords = byDate.reduce((s, e) => s + e.count, 0);
    const totalRecordsPagoValidado = byDayPagoValidado
      ? byMonthPagoValidado.get(month) ?? 0
      : undefined;
    const totalRecordsPagoValidadoDec = byDayPagoValidadoDec
      ? byMonthPagoValidadoDec.get(month) ?? 0
      : undefined;
    const daysWithData = byDate.length;
    return { month, totalRecords, totalRecordsPagoValidado, totalRecordsPagoValidadoDec, daysWithData, byDate };
  });
  await ctx.runMutation(api.datamappingMutations.replaceAllDatamappingMonthStats, { months });
}

/** Agrega datamappingRecords por total, año, mes y día (por updatedAt). Para sección Registros cargados.
 *  Se programa tras finalizar sync datamapping (por eso en logs aparece tras [datamapping] fetchDatamappingForDay). */
export const getDatamappingIngestionStats = action({
  args: {},
  handler: async (ctx): Promise<{
    total: number;
    totalPagoValidado: number;
    totalPagoValidadoDec: number;
    byYear: Array<{ year: string; count: number }>;
    byYearPagoValidado: Array<{ year: string; count: number }>;
    byYearPagoValidadoDec: Array<{ year: string; count: number }>;
    byMonth: Array<{ month: string; count: number }>;
    byMonthPagoValidado: Array<{ month: string; count: number }>;
    byMonthPagoValidadoDec: Array<{ month: string; count: number }>;
    byDay: Array<{ date: string; count: number }>;
    byDayPagoValidado: Array<{ date: string; count: number }>;
    byDayPagoValidadoDec: Array<{ date: string; count: number }>;
  }> => {
    const byDay = new Map<string, number>();
    const byDayPagoValidado = new Map<string, number>();
    const byDayPagoValidadoDec = new Map<string, number>();
    const byMonth = new Map<string, number>();
    const byMonthPagoValidado = new Map<string, number>();
    const byMonthPagoValidadoDec = new Map<string, number>();
    const byYear = new Map<string, number>();
    const byYearPagoValidado = new Map<string, number>();
    const byYearPagoValidadoDec = new Map<string, number>();
    let total = 0;
    let totalPagoValidado = 0;
    let totalPagoValidadoDec = 0;
    let cursor: string | undefined;
    const startMs = Date.now();
    let pageCount = 0;
    console.log("[datamapping] getDatamappingIngestionStats started (post-sync stats; paginates over datamappingRecords)");
    do {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
        break;
      }
      const result = (await ctx.runQuery(api.datamappingQueries.getDatamappingRecordsPageForIngestionStats, {
        cursor,
        numItems: 2000,
      })) as {
        page: { updatedAt: string; status?: string; fuente?: string }[];
        continueCursor: string;
        isDone: boolean;
      };
      for (const r of result.page) {
        const u = r.updatedAt ?? "";
        const dateStr = u.includes("T") ? u.slice(0, 10) : u.slice(0, 10);
        if (dateStr.length >= 10) {
          const monthStr = dateStr.slice(0, 7);
          const yearStr = dateStr.slice(0, 4);
          byDay.set(dateStr, (byDay.get(dateStr) ?? 0) + 1);
          byMonth.set(monthStr, (byMonth.get(monthStr) ?? 0) + 1);
          byYear.set(yearStr, (byYear.get(yearStr) ?? 0) + 1);
          total++;
          if (isPagoValidadoStatus(r.status)) {
            byDayPagoValidado.set(dateStr, (byDayPagoValidado.get(dateStr) ?? 0) + 1);
            byMonthPagoValidado.set(monthStr, (byMonthPagoValidado.get(monthStr) ?? 0) + 1);
            byYearPagoValidado.set(yearStr, (byYearPagoValidado.get(yearStr) ?? 0) + 1);
            totalPagoValidado++;
            if (isDecFuente(r.fuente)) {
              byDayPagoValidadoDec.set(dateStr, (byDayPagoValidadoDec.get(dateStr) ?? 0) + 1);
              byMonthPagoValidadoDec.set(monthStr, (byMonthPagoValidadoDec.get(monthStr) ?? 0) + 1);
              byYearPagoValidadoDec.set(yearStr, (byYearPagoValidadoDec.get(yearStr) ?? 0) + 1);
              totalPagoValidadoDec++;
            }
          }
        }
      }
      pageCount += 1;
      if (pageCount % 50 === 0) {
        console.log("[datamapping] getDatamappingIngestionStats progress", { pageCount, total, elapsedMs: Date.now() - startMs });
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    } while (cursor);
    console.log("[datamapping] getDatamappingIngestionStats completed", { pageCount, total, elapsedMs: Date.now() - startMs });
    const resultData = {
      total,
      totalPagoValidado,
      totalPagoValidadoDec,
      byYear: Array.from(byYear.entries())
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      byYearPagoValidado: Array.from(byYearPagoValidado.entries())
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      byYearPagoValidadoDec: Array.from(byYearPagoValidadoDec.entries())
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      byMonth: Array.from(byMonth.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byMonthPagoValidado: Array.from(byMonthPagoValidado.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byMonthPagoValidadoDec: Array.from(byMonthPagoValidadoDec.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byDay: Array.from(byDay.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byDayPagoValidado: Array.from(byDayPagoValidado.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byDayPagoValidadoDec: Array.from(byDayPagoValidadoDec.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
    await ctx.runMutation(api.datamappingMutations.setDatamappingIngestionStats, resultData);
    await recreateAllDatamappingMonthStatsFromRecordsInternal(ctx, byDay, byDayPagoValidado, byDayPagoValidadoDec);
    return resultData;
  },
});

/** Recalcula datamappingMonthStats desde datamappingRecords (por updatedAt). Para UI espejo y "Recalcular datamapping". */
export const recreateAllDatamappingMonthStatsFromRecords = action({
  args: {},
  handler: async (ctx): Promise<{ monthsUpdated: number }> => {
    const byMonthByDate = new Map<string, Map<string, number>>();
    const byDayPagoValidado = new Map<string, number>();
    const byDayPagoValidadoDec = new Map<string, number>();
    let cursor: string | undefined;
    const startMs = Date.now();
    do {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
        throw new Error("Límite de tiempo alcanzado. Reejecutar para continuar.");
      }
      const result = (await ctx.runQuery(api.datamappingQueries.getDatamappingRecordsPageForIngestionStats, {
        cursor,
        numItems: 2000,
      })) as {
        page: { updatedAt: string; status?: string; fuente?: string }[];
        continueCursor: string;
        isDone: boolean;
      };
      for (const r of result.page) {
        const u = r.updatedAt ?? "";
        const dateStr = u.includes("T") ? u.slice(0, 10) : u.slice(0, 10);
        if (dateStr.length >= 10) {
          const monthStr = dateStr.slice(0, 7);
          let dayMap = byMonthByDate.get(monthStr);
          if (!dayMap) {
            dayMap = new Map<string, number>();
            byMonthByDate.set(monthStr, dayMap);
          }
          dayMap.set(dateStr, (dayMap.get(dateStr) ?? 0) + 1);
          if (isPagoValidadoStatus(r.status)) {
            byDayPagoValidado.set(dateStr, (byDayPagoValidado.get(dateStr) ?? 0) + 1);
            if (isDecFuente(r.fuente)) {
              byDayPagoValidadoDec.set(dateStr, (byDayPagoValidadoDec.get(dateStr) ?? 0) + 1);
            }
          }
        }
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    } while (cursor);
    const byMonthPagoValidado = new Map<string, number>();
    for (const [dateStr, count] of byDayPagoValidado) {
      if (dateStr.length < 10) continue;
      const monthStr = dateStr.slice(0, 7);
      byMonthPagoValidado.set(monthStr, (byMonthPagoValidado.get(monthStr) ?? 0) + count);
    }
    const byMonthPagoValidadoDec = new Map<string, number>();
    for (const [dateStr, count] of byDayPagoValidadoDec) {
      if (dateStr.length < 10) continue;
      const monthStr = dateStr.slice(0, 7);
      byMonthPagoValidadoDec.set(monthStr, (byMonthPagoValidadoDec.get(monthStr) ?? 0) + count);
    }
    const months = Array.from(byMonthByDate.entries()).map(([month, dayMap]) => {
      const byDate = Array.from(dayMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const totalRecords = byDate.reduce((s, e) => s + e.count, 0);
      const totalRecordsPagoValidado = byMonthPagoValidado.get(month);
      const totalRecordsPagoValidadoDec = byMonthPagoValidadoDec.get(month);
      const daysWithData = byDate.length;
      return {
        month,
        totalRecords,
        totalRecordsPagoValidado: totalRecordsPagoValidado !== undefined ? totalRecordsPagoValidado : undefined,
        totalRecordsPagoValidadoDec: totalRecordsPagoValidadoDec !== undefined ? totalRecordsPagoValidadoDec : undefined,
        daysWithData,
        byDate,
      };
    });
    await ctx.runMutation(api.datamappingMutations.replaceAllDatamappingMonthStats, { months });
    return { monthsUpdated: months.length };
  },
});

/** Recalcula datamappingMonthStatsByFechaTransaccion desde datamappingRecords (por fechaTransaccionMexico = mes del pago). Para comparación con paymentRecords. */
export const recreateDatamappingMonthStatsByFechaTransaccion = action({
  args: {},
  handler: async (ctx): Promise<{ monthsUpdated: number }> => {
    const ACTION_TIME_LIMIT_MS = 550_000;
    const isDec = (fuente: string | undefined) => (fuente ?? "").trim().toUpperCase() === "DEC";

    const cwMonths = (await ctx.runQuery(api.cloudwatchQueries.getAllMonthsStatus, {})) as { month: string }[];
    const monthsToCompute = cwMonths.length > 0
      ? cwMonths.map((m) => m.month).sort()
      : ["2025-12", "2026-01", "2026-02"];

    const months: Array<{
      month: string;
      totalRecords: number;
      totalRecordsPagoValidado: number;
      totalRecordsPagoValidadoDec: number;
      daysWithData: number;
      byDate: Array<{ date: string; count: number }>;
      byDatePagoValidadoDec: Array<{ date: string; count: number }>;
    }> = [];

    const startMs = Date.now();
    for (const month of monthsToCompute) {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
        throw new Error("Límite de tiempo alcanzado. Reejecutar para continuar.");
      }
      const byDate = new Map<string, number>();
      const byDateDec = new Map<string, number>();
      let totalRecords = 0;
      let totalRecordsPagoValidado = 0;
      let totalRecordsPagoValidadoDec = 0;
      let cursor: string | null = null;
      do {
        const result = (await ctx.runQuery(
          api.datamappingQueries.getDatamappingRecordsByMonthPaginated,
          { month, paginationOpts: { numItems: 1000, cursor }, useFechaTransaccion: true }
        )) as {
          page: Array<{ fuente?: string; fechaTransaccionMexico?: string }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        for (const r of result.page) {
          totalRecords += 1;
          totalRecordsPagoValidado += 1;
          if (isDec(r.fuente)) totalRecordsPagoValidadoDec += 1;
          const dateStr = (r.fechaTransaccionMexico ?? "").slice(0, 10);
          if (dateStr.length >= 10) {
            byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + 1);
            if (isDec(r.fuente)) {
              byDateDec.set(dateStr, (byDateDec.get(dateStr) ?? 0) + 1);
            }
          }
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);

      const byDateSorted = Array.from(byDate.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const byDatePagoValidadoDecSorted = Array.from(byDate.entries())
        .map(([date]) => ({ date, count: byDateDec.get(date) ?? 0 }))
        .sort((a, b) => a.date.localeCompare(b.date));
      months.push({
        month,
        totalRecords,
        totalRecordsPagoValidado,
        totalRecordsPagoValidadoDec,
        daysWithData: byDate.size,
        byDate: byDateSorted,
        byDatePagoValidadoDec: byDatePagoValidadoDecSorted,
      });
    }

    await ctx.runMutation(api.datamappingMutations.replaceAllDatamappingMonthStatsByFechaTransaccion, { months });
    return { monthsUpdated: months.length };
  },
});
