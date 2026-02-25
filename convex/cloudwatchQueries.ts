import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { timestampToMexicoMonth } from "./lib/mexicoDate";

/** Límite Convex: 8192 items por retorno. Clamp para paginación reactiva. */
const MAX_PAGE_ITEMS = 1000;

/** Límite de referencias por batch en getFechaTransaccionForReferencias. */
const MAX_REFERENCIAS_FECHA_LOOKUP = 500;

/** Lee estadísticas precalculadas del mes (tabla monthStats). Eficiente, sin agregar paymentRecords. */
export const getMonthStats = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const doc = await ctx.db
      .query("monthStats")
      .withIndex("by_month", (q) => q.eq("month", month))
      .first();
    if (!doc) return null;
    return {
      kpis: doc.kpis,
      dailyBreakdown: { month: doc.month, days: doc.dailyBreakdown },
      movementStats: { month: doc.month, byMovimiento: doc.movementStats },
      sourceStats: {
        month: doc.month,
        totalPagos: doc.kpis.totalPagos,
        montoTotal: doc.kpis.montoTotal,
        sources: doc.sourceStats,
      },
      ingestionStatus: {
        month: doc.month,
        ...doc.ingestionStatus,
      },
    };
  },
});

/** Resumen de todos los meses con datos (para grilla de Registros Cargados). */
export const getAllMonthsStatus = query({
  args: {},
  handler: async (ctx) => {
    const allStats = await ctx.db.query("monthStats").collect();
    return allStats.map((s) => ({
      month: s.month,
      totalRecords: s.ingestionStatus.totalRecords,
      daysWithData: s.ingestionStatus.daysWithData,
      lastUpdated: s.lastUpdated,
    }));
  },
});

/** Auditoría de ingestión por fecha (para diagnóstico de diferencias CloudWatch vs Convex). */
export const getCloudwatchIngestionAuditByDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    return await ctx.db
      .query("cloudwatchIngestionAudit")
      .withIndex("by_date", (q) => q.eq("date", date))
      .first();
  },
});

/** Lista auditorías en un rango de fechas (orden ascendente). */
export const listCloudwatchIngestionAudit = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, { startDate, endDate }) => {
    const all = await ctx.db.query("cloudwatchIngestionAudit").collect();
    return all
      .filter((a) => a.date >= startDate && a.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

/** Query paginada para evitar límite de retorno (8192 items). Usar en Detalle. */
export const getPaymentsByMonthPaginated = query({
  args: {
    month: v.string(),
    paginationOpts: paginationOptsValidator,
    source: v.optional(
      v.union(v.literal("v1"), v.literal("v2"), v.literal("payment"))
    ),
  },
  handler: async (ctx, { month, paginationOpts, source }) => {
    const safeOpts = {
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, MAX_PAGE_ITEMS),
    };
    if (source) {
      return await ctx.db
        .query("paymentRecords")
        .withIndex("by_source_month_referencia", (q) =>
          q.eq("logSource", source).eq("importMonth", month)
        )
        .order("asc")
        .paginate(safeOpts);
    }
    return await ctx.db
      .query("paymentRecords")
      .withIndex("by_month_and_referencia", (q) =>
        q.eq("importMonth", month)
      )
      .order("asc")
      .paginate(safeOpts);
  },
});

export const searchByReferencia = query({
  args: { referencia: v.string() },
  handler: async (ctx, { referencia }) => {
    return await ctx.db
      .query("paymentRecords")
      .withIndex("by_referencia", (q) => q.eq("referencia", referencia))
      .collect();
  },
});

/** Query auxiliar: retorna una página de paymentRecords por mes. */
export const getPaymentRecordsPageByMonth = query({
  args: {
    month: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { month, cursor, numItems = 5000 }) => {
    const result = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => r.referencia),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Página con detalles (importDate, monto, logSource) para diagnóstico. */
export const getPaymentRecordsPageWithDetails = query({
  args: {
    month: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { month, cursor, numItems = 5000 }) => {
    const result = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        timestamp: r.timestamp,
        importDate: r.importDate,
        importMonth: r.importMonth,
        monto: r.monto,
        logSource: r.logSource,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Verifica duplicados en un solo mes (por debajo del límite de lectura Convex: 32k docs).
 * Lee como máximo MAX_READS_DUPLICATES registros del mes; si el mes tiene más, devuelve truncated: true.
 */
const MAX_READS_DUPLICATES = 30_000;

export const findDuplicateReferenciasInMonth = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const result = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .order("asc")
      .paginate({ numItems: MAX_READS_DUPLICATES, cursor: null });

    const records = result.page;
    const truncated = !result.isDone;

    const countByRef = new Map<string, number>();
    for (const rec of records) {
      countByRef.set(rec.referencia, (countByRef.get(rec.referencia) ?? 0) + 1);
    }

    const duplicates: Array<{ referencia: string; count: number }> = [];
    for (const [ref, count] of countByRef) {
      if (count > 1) {
        duplicates.push({ referencia: ref, count });
      }
    }

    duplicates.sort((a, b) => b.count - a.count);

    return {
      month,
      totalRecords: records.length,
      uniqueReferencias: countByRef.size,
      duplicateReferencias: duplicates.length,
      totalDuplicateRecords: duplicates.reduce((s, d) => s + d.count, 0),
      top: duplicates.slice(0, 20),
      truncated,
    };
  },
});

/**
 * Devuelve fechaTransaccion desde paymentRecords por referencia.
 * Si hay varios paymentRecords con la misma referencia, prioriza el que tenga monto coincidente; si no, el primero.
 * Usado por backfill de fechaTransaccion en datamappingRecords.
 */
export const getFechaTransaccionForReferencias = query({
  args: {
    referencias: v.array(
      v.object({ referencia: v.string(), monto: v.number() })
    ),
  },
  handler: async (ctx, { referencias }): Promise<Record<string, string>> => {
    const refs = referencias.slice(0, MAX_REFERENCIAS_FECHA_LOOKUP);
    const out: Record<string, string> = {};
    for (const { referencia, monto } of refs) {
      const records = await ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", referencia))
        .collect();
      if (records.length === 0) continue;
      const exactMatch = records.find((r) => r.monto === monto);
      const chosen = exactMatch ?? records[0];
      out[referencia] = chosen.fechaTransaccion;
    }
    return out;
  },
});

/** Para enriquecer filas "Solo en Datamapping": devuelve mes (YYYY-MM) en hora México de paymentRecords por referencia (máx 300 refs). */
const MAX_REFERENCIAS_LOOKUP = 300;

/** Devuelve importMonth y fechaTransaccion de paymentRecords por referencia (máx 500 refs). Para reporte de reconciliación. */
export const getPaymentRecordDetailsForReferencias = query({
  args: { referencias: v.array(v.string()) },
  handler: async (ctx, { referencias }): Promise<Record<string, { importMonth: string; fechaTransaccion: string }>> => {
    const refs = referencias.slice(0, 500);
    const out: Record<string, { importMonth: string; fechaTransaccion: string }> = {};
    for (const ref of refs) {
      const rec = await ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (!rec) continue;
      const month =
        rec.timestamp && /^\d{4}/.test(rec.timestamp)
          ? timestampToMexicoMonth(rec.timestamp)
          : (rec.importMonth ?? "").substring(0, 7);
      out[ref] = {
        importMonth: (month || rec.importMonth) ?? "",
        fechaTransaccion: rec.fechaTransaccion ?? "",
      };
    }
    return out;
  },
});

export const getPaymentRecordsMonthsForReferencias = query({
  args: { referencias: v.optional(v.array(v.string())) },
  handler: async (ctx, { referencias }) => {
    const list = referencias ?? [];
    const refs = list.slice(0, MAX_REFERENCIAS_LOOKUP);
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const rec = await ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (!rec) continue;
      const month =
        rec.timestamp && /^\d{4}/.test(rec.timestamp)
          ? timestampToMexicoMonth(rec.timestamp)
          : (rec.importMonth ?? "").substring(0, 7);
      if (month) out[ref] = month;
    }
    return out;
  },
});

/** Devuelve la última fecha (YYYY-MM-DD) sincronizada para cloudwatch incremental (null si nunca se ha corrido). */
export const getCloudwatchWatermark = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", "cloudwatch_watermark"))
      .first();
    return { lastSyncedDate: doc?.lastProcessedTimestamp ?? null };
  },
});

/** Lista registros de cloudwatchSourceV1 por importDate (para consolidación). */
export const listCloudwatchSourceV1ByDate = query({
  args: {
    importDate: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { importDate, cursor, numItems = 500 }) => {
    const result = await ctx.db
      .query("cloudwatchSourceV1")
      .withIndex("by_importDate", (q) => q.eq("importDate", importDate))
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        timestamp: r.timestamp,
        fechaTransaccion: r.fechaTransaccion,
        logSource: "v1" as const,
        movimiento: r.movimiento,
        estatus: r.estatus,
        tramiteId: r.tramiteId,
        importMonth: r.importMonth,
        importDate: r.importDate,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Lista registros de cloudwatchSourceV2 por importDate (para consolidación). */
export const listCloudwatchSourceV2ByDate = query({
  args: {
    importDate: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { importDate, cursor, numItems = 500 }) => {
    const result = await ctx.db
      .query("cloudwatchSourceV2")
      .withIndex("by_importDate", (q) => q.eq("importDate", importDate))
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        timestamp: r.timestamp,
        fechaTransaccion: r.fechaTransaccion,
        logSource: "v2" as const,
        movimiento: r.movimiento,
        estatus: r.estatus,
        tramiteId: r.tramiteId,
        importMonth: r.importMonth,
        importDate: r.importDate,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Lista registros de cloudwatchSourcePayment por importDate (para consolidación). */
export const listCloudwatchSourcePaymentByDate = query({
  args: {
    importDate: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { importDate, cursor, numItems = 500 }) => {
    const result = await ctx.db
      .query("cloudwatchSourcePayment")
      .withIndex("by_importDate", (q) => q.eq("importDate", importDate))
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        timestamp: r.timestamp,
        fechaTransaccion: r.fechaTransaccion,
        logSource: "payment" as const,
        movimiento: r.movimiento,
        estatus: r.estatus,
        tramiteId: r.tramiteId,
        importMonth: r.importMonth,
        importDate: r.importDate,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
