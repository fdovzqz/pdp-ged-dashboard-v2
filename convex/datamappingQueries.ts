import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { timestampToMexicoMonth } from "./lib/mexicoDate";
import { extractStatusAndFuenteFromRawJson } from "./lib/dynamodb";

/** Valor de status que se considera pago validado en DataMapping. Usado en reconciliación y agregaciones. */
const PAGO_VALIDADO_STATUS = "PAGO VALIDADO";

/** Rango amplio para consultas datamapping sin filtro de fecha. */
const DATAMAPPING_UNIVERSE_START = "2000-01-01T00:00:00.000Z";
const DATAMAPPING_UNIVERSE_END = "2031-01-01T00:00:00.000Z";

/** Tamaño de página para no exceder 16MB por lectura (datamapping tiene rawJson grande). */
const JAN_2026_DATAMAPPING_PAGE_SIZE = 500;

/** Obtiene el primer día del mes siguiente (YYYY-MM). */
function getNextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return `${month}-02`;
  const next = new Date(y, m, 1);
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}-01`;
}

/**
 * Página de datamappingRecords filtrada por mes (updatedAt o fechaTransaccion en rango) y solo status = PAGO VALIDADO.
 */
export const getDatamappingRecordsByMonthPaginated = query({
  args: {
    month: v.string(),
    paginationOpts: paginationOptsValidator,
    useFechaTransaccion: v.optional(v.boolean()),
  },
  handler: async (ctx, { month, paginationOpts, useFechaTransaccion }) => {
    const start = `${month}-01`;
    const end = getNextMonthStart(month);
    const safeOpts = {
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, 1000),
    };
    if (useFechaTransaccion) {
      const result = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_status_fechaTransaccionMexico", (q) =>
          q
            .eq("status", PAGO_VALIDADO_STATUS)
            .gte("fechaTransaccionMexico", start)
            .lt("fechaTransaccionMexico", end)
        )
        .order("asc")
        .paginate(safeOpts);
      return {
        page: result.page.map((r) => ({
          referencia: r.referencia,
          monto: r.monto,
          updatedAt: r.updatedAt,
          fechaTransaccion: r.fechaTransaccion,
          fechaTransaccionMexico: r.fechaTransaccionMexico,
          tipoMovimiento: r.tipoMovimiento,
          fuente: r.fuente,
        })),
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_status_updatedAt", (q) =>
        q
          .eq("status", PAGO_VALIDADO_STATUS)
          .gte("updatedAt", start)
          .lt("updatedAt", end)
      )
      .order("asc")
      .paginate(safeOpts);
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
        fechaTransaccion: r.fechaTransaccion,
        tipoMovimiento: r.tipoMovimiento,
        fuente: r.fuente,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingIngestionStatsSaved = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("datamappingIngestionStats").first();
    if (!doc) return null;
    return {
      total: doc.total,
      totalPagoValidado: doc.totalPagoValidado,
      totalPagoValidadoDec: doc.totalPagoValidadoDec,
      byYear: doc.byYear,
      byYearPagoValidado: doc.byYearPagoValidado,
      byYearPagoValidadoDec: doc.byYearPagoValidadoDec,
      byMonth: doc.byMonth,
      byMonthPagoValidado: doc.byMonthPagoValidado,
      byMonthPagoValidadoDec: doc.byMonthPagoValidadoDec,
      byDay: doc.byDay,
      byDayPagoValidado: doc.byDayPagoValidado,
      byDayPagoValidadoDec: doc.byDayPagoValidadoDec,
      lastUpdated: doc.lastUpdated,
    };
  },
});

export const getAllDatamappingMonthsStatus = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("datamappingMonthStats").collect();
    return docs.map((s) => ({
      month: s.month,
      totalRecords: s.totalRecords,
      totalRecordsPagoValidado: s.totalRecordsPagoValidado,
      totalRecordsPagoValidadoDec: s.totalRecordsPagoValidadoDec,
      daysWithData: s.daysWithData,
      lastUpdated: s.lastUpdated,
    }));
  },
});

export const getDatamappingMonthStats = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const doc = await ctx.db
      .query("datamappingMonthStats")
      .withIndex("by_month", (q) => q.eq("month", month))
      .first();
    if (!doc) return null;
    return {
      month: doc.month,
      totalRecords: doc.totalRecords,
      totalRecordsPagoValidado: doc.totalRecordsPagoValidado,
      totalRecordsPagoValidadoDec: doc.totalRecordsPagoValidadoDec,
      daysWithData: doc.daysWithData,
      byDate: doc.byDate,
      lastUpdated: doc.lastUpdated,
    };
  },
});

/** Estadísticas por mes agrupadas por fechaTransaccion (mes del pago). Para comparación con paymentRecords. */
export const getAllDatamappingMonthsStatusByFechaTransaccion = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("datamappingMonthStatsByFechaTransaccion").collect();
    return docs.map((s) => ({
      month: s.month,
      totalRecords: s.totalRecords,
      totalRecordsPagoValidado: s.totalRecordsPagoValidado,
      totalRecordsPagoValidadoDec: s.totalRecordsPagoValidadoDec,
      daysWithData: s.daysWithData,
      lastUpdated: s.lastUpdated,
    }));
  },
});

export const getDatamappingMonthStatsByFechaTransaccion = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const doc = await ctx.db
      .query("datamappingMonthStatsByFechaTransaccion")
      .withIndex("by_month", (q) => q.eq("month", month))
      .first();
    if (!doc) return null;
    return {
      month: doc.month,
      totalRecords: doc.totalRecords,
      totalRecordsPagoValidado: doc.totalRecordsPagoValidado,
      totalRecordsPagoValidadoDec: doc.totalRecordsPagoValidadoDec,
      daysWithData: doc.daysWithData,
      byDate: doc.byDate,
      byDatePagoValidadoDec: doc.byDatePagoValidadoDec,
      lastUpdated: doc.lastUpdated,
    };
  },
});

export const getDatamappingRecordsPageForIngestionStats = query({
  args: {
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, numItems = 2000 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => ({
        updatedAt: r.updatedAt,
        status: r.status,
        fuente: r.fuente,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const getDatamappingRecordsByRfcs = query({
  args: {
    rfcs: v.array(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  handler: async (ctx, { rfcs, fromDate, toDate }) => {
    const rfcsNormalized = rfcs
      .map((r) => r.trim().toUpperCase())
      .filter((r) => r.length > 0);
    const updatedAtFrom = fromDate
      ? (fromDate.includes("T") ? fromDate : `${fromDate}T00:00:00.000Z`)
      : "2026-01-01T00:00:00.000Z";
    const updatedAtTo = toDate
      ? (toDate.includes("T")
          ? toDate
          : (() => {
              const [y, m, d] = toDate.split("-").map(Number);
              const next = new Date(Date.UTC(y, m - 1, d + 1));
              return next.toISOString().replace(/\.\d{3}Z$/, ".000Z");
            })())
      : "2030-12-31T23:59:59.999Z";

    const results: Array<{
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
    }> = [];
    for (const rfc of rfcsNormalized) {
      const records = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_rfc", (q) => q.eq("rfc", rfc))
        .collect();
      for (const r of records) {
        const u = r.updatedAt ?? "";
        if (u >= updatedAtFrom && u < updatedAtTo) {
          let fuente = r.fuente;
          let status = r.status;
          let loteId = r.loteId;
          let reciboPagoUrl: string | undefined;
          let endMonth: string | undefined;
          let declarationType: string | undefined;
          if (r.rawJson) {
            const fromRaw = extractStatusAndFuenteFromRawJson(r.rawJson);
            if (!status && fromRaw.status) status = fromRaw.status;
            if (!fuente && fromRaw.fuente) fuente = fromRaw.fuente;
            if (!loteId && fromRaw.loteId) loteId = fromRaw.loteId;
            reciboPagoUrl = fromRaw.reciboPagoUrl;
            endMonth = fromRaw.endMonth;
            declarationType = fromRaw.declarationType;
          }
          results.push({
            rfc,
            referencia: r.referencia,
            monto: r.monto,
            updatedAt: r.updatedAt,
            tipoMovimiento: r.tipoMovimiento,
            fuente: fuente ?? r.fuente,
            status: status ?? r.status,
            loteId: loteId ?? undefined,
            tramiteId: r.tramiteId,
            reciboPagoUrl: reciboPagoUrl ?? undefined,
            endMonth: endMonth ?? undefined,
            declarationType: declarationType ?? undefined,
          });
        }
      }
    }
    return results;
  },
});

export const getLatestRfcInvestigationResults = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("rfcInvestigationResults")
      .withIndex("by_runAt")
      .order("desc")
      .first();
    if (!doc || !doc.matches.length) return doc ?? null;
    const matchesWithRawJson = await Promise.all(
      doc.matches.map(async (m) => {
        const record = await ctx.db
          .query("datamappingRecords")
          .withIndex("by_referencia", (q) => q.eq("referencia", m.referencia))
          .first();
        if (!record?.rawJson) return m;
        const fromRaw = extractStatusAndFuenteFromRawJson(record.rawJson);
        return {
          ...m,
          reciboPagoUrl: fromRaw.reciboPagoUrl ?? m.reciboPagoUrl,
          endMonth: fromRaw.endMonth ?? (m as { endMonth?: string }).endMonth,
          declarationType:
            fromRaw.declarationType ?? (m as { declarationType?: string }).declarationType,
        };
      })
    );
    return {
      ...doc,
      matches: matchesWithRawJson,
    };
  },
});

/** Respuesta rápida (1 lectura): ¿hay al menos un registro pendiente de enriquecer en este día?
 * Usa el índice by_enrichmentExtracted_updatedAt. Para iterar mes por día y saltar días sin trabajo. */
export const hasPendingEnrichmentForDay = query({
  args: { month: v.string(), day: v.number() },
  handler: async (ctx, { month, day }) => {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m || day < 1 || day > 31) return { hasPending: false, month, day };
    const dd = String(day).padStart(2, "0");
    const updatedAtFrom = `${month}-${dd}T00:00:00.000Z`;
    const dayEnd = new Date(Date.UTC(y, m - 1, day, 23, 59, 59, 999));
    const updatedAtTo = new Date(dayEnd.getTime() + 1).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const one = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_enrichmentExtracted_updatedAt", (q) =>
        q
          .eq("enrichmentExtracted", false)
          .gte("updatedAt", updatedAtFrom)
          .lt("updatedAt", updatedAtTo)
      )
      .first();
    return { hasPending: one != null, month, day };
  },
});

/** Respuesta rápida (1 lectura): ¿hay al menos un registro pendiente de enriquecer en este mes?
 * Usa el índice by_enrichmentExtracted_updatedAt con take(1). */
export const hasPendingEnrichmentForMonth = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return { hasPending: false, month };
    const updatedAtFrom = `${month}-01T00:00:00.000Z`;
    const nextMonth = m === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
    const updatedAtTo = nextMonth.toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const one = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_enrichmentExtracted_updatedAt", (q) =>
        q
          .eq("enrichmentExtracted", false)
          .gte("updatedAt", updatedAtFrom)
          .lt("updatedAt", updatedAtTo)
      )
      .first();
    return { hasPending: one != null, month };
  },
});

/** Para varios meses: indica si cada uno tiene pendientes de enriquecer (una lectura por mes).
 * Útil para precheck antes de lanzar enriquecimiento por meses. */
export const getPendingEnrichmentByMonths = query({
  args: { months: v.array(v.string()) },
  handler: async (ctx, { months }) => {
    const out: Record<string, boolean> = {};
    for (const month of months) {
      const [y, m] = month.split("-").map(Number);
      if (!y || !m) {
        out[month] = false;
        continue;
      }
      const updatedAtFrom = `${month}-01T00:00:00.000Z`;
      const nextMonth = m === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
      const updatedAtTo = nextMonth.toISOString().replace(/\.\d{3}Z$/, ".000Z");
      const one = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_enrichmentExtracted_updatedAt", (q) =>
          q
            .eq("enrichmentExtracted", false)
            .gte("updatedAt", updatedAtFrom)
            .lt("updatedAt", updatedAtTo)
        )
        .first();
      out[month] = one != null;
    }
    return out;
  },
});

export const getDatamappingPageWithRawJsonNeedingEnrichment = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 50 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_enrichmentExtracted_updatedAt", (q) =>
        q
          .eq("enrichmentExtracted", false)
          .gte("updatedAt", updatedAtFrom)
          .lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        _id: r._id,
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
        tipoMovimiento: r.tipoMovimiento,
        fuente: r.fuente,
        rawJson: r.rawJson,
        rfc: r.rfc,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingIdsNeedingEnrichment = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 2000 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_enrichmentExtracted_updatedAt", (q) =>
        q
          .eq("enrichmentExtracted", false)
          .gte("updatedAt", updatedAtFrom)
          .lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({ _id: r._id })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingPageByDateRange = query({
  args: {
    updatedAtFrom: v.optional(v.string()),
    updatedAtTo: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = JAN_2026_DATAMAPPING_PAGE_SIZE }) => {
    const from = updatedAtFrom ?? DATAMAPPING_UNIVERSE_START;
    const to = updatedAtTo ?? DATAMAPPING_UNIVERSE_END;
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_status_updatedAt", (q) =>
        q.eq("status", PAGO_VALIDADO_STATUS).gte("updatedAt", from).lt("updatedAt", to)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingPageByFechaTransaccionMexicoRange = query({
  args: {
    fechaFrom: v.string(),
    fechaTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { fechaFrom, fechaTo, cursor, numItems = JAN_2026_DATAMAPPING_PAGE_SIZE }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_status_fechaTransaccionMexico", (q) =>
        q
          .eq("status", PAGO_VALIDADO_STATUS)
          .gte("fechaTransaccionMexico", fechaFrom)
          .lt("fechaTransaccionMexico", fechaTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingPageIdForBackfill = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, numItems = 400 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", DATAMAPPING_UNIVERSE_START).lt("updatedAt", DATAMAPPING_UNIVERSE_END)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({ _id: r._id })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingPageIdForBackfillByRange = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 400 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", updatedAtFrom).lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({ _id: r._id })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingPageForFechaTransaccionMexicoBackfill = query({
  args: {
    fechaTransaccionFrom: v.string(),
    fechaTransaccionTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { fechaTransaccionFrom, fechaTransaccionTo, cursor, numItems = 500 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_status_fechaTransaccion", (q) =>
        q
          .eq("status", PAGO_VALIDADO_STATUS)
          .gte("fechaTransaccion", fechaTransaccionFrom)
          .lt("fechaTransaccion", fechaTransaccionTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        _id: r._id,
        fechaTransaccion: r.fechaTransaccion ?? "",
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDatamappingPageForFechaTransaccionBackfill = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 200 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", updatedAtFrom).lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        _id: r._id,
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

const MAX_REFERENCIAS_LOOKUP = 300;

export const getDatamappingMonthsForReferencias = query({
  args: { referencias: v.optional(v.array(v.string())) },
  handler: async (ctx, { referencias }) => {
    const list = referencias ?? [];
    const refs = list.slice(0, MAX_REFERENCIAS_LOOKUP);
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const rec = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (rec?.updatedAt) out[ref] = timestampToMexicoMonth(rec.updatedAt);
    }
    return out;
  },
});

export const getDatamappingUpdatedAtForReferencias = query({
  args: { referencias: v.optional(v.array(v.string())) },
  handler: async (ctx, { referencias }) => {
    const list = referencias ?? [];
    const refs = list.slice(0, MAX_REFERENCIAS_LOOKUP);
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const rec = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (rec?.updatedAt) out[ref] = rec.updatedAt;
    }
    return out;
  },
});

export const getDatamappingWatermark = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", "datamapping_watermark"))
      .first();
    return { lastUpdatedAt: doc?.lastProcessedTimestamp ?? null };
  },
});
