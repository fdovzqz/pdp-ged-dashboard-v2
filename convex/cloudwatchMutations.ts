import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { timestampToMexicoDate } from "./lib/mexicoDate";
import {
  getMovementConfig,
  normalizeWithConfig,
} from "./movementCodes";

/** Máx lecturas por lote para respetar límite Convex 4096/mutación. */
const BATCH_READS = 500;

const paymentRecordValidator = v.object({
  referencia: v.string(),
  monto: v.number(),
  timestamp: v.string(),
  fechaTransaccion: v.string(),
  logSource: v.union(
    v.literal("v1"),
    v.literal("v2"),
    v.literal("payment")
  ),
  movimiento: v.string(),
  estatus: v.string(),
  tramiteId: v.optional(v.number()),
  rawData: v.optional(v.string()),
  importMonth: v.string(),
  importDate: v.optional(v.string()),
});

/** Fecha YYYY-MM-DD en hora México (UTC-6). Timestamps cloudwatch son UTC. */
function extractImportDate(ts: string, fechaTxn: string): string {
  if (ts && /^\d{4}/.test(ts)) {
    const d = timestampToMexicoDate(ts);
    if (d) return d;
  }
  if (fechaTxn && /^\d{4}/.test(fechaTxn)) {
    const d = timestampToMexicoDate(fechaTxn);
    if (d) return d;
  }
  return "";
}

export const ingestPaymentBatch = mutation({
  args: {
    records: v.array(paymentRecordValidator),
  },
  handler: async (ctx, { records }) => {
    let inserted = 0;
    let skipped = 0;

    for (const rec of records) {
      const existing = await ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", rec.referencia))
        .first();

      if (existing) {
        skipped += 1;
        continue;
      }

      const importDate =
        rec.importDate ??
        extractImportDate(rec.timestamp, rec.fechaTransaccion);

      await ctx.db.insert("paymentRecords", {
        referencia: rec.referencia,
        monto: rec.monto,
        timestamp: rec.timestamp,
        fechaTransaccion: rec.fechaTransaccion,
        logSource: rec.logSource,
        movimiento: rec.movimiento,
        estatus: rec.estatus,
        tramiteId: rec.tramiteId,
        rawData: rec.rawData,
        importMonth: rec.importMonth,
        ...(importDate ? { importDate } : {}),
      });
      inserted += 1;
    }

    return { inserted, skipped };
  },
});

const cloudwatchIngestionAuditValidator = v.object({
  date: v.string(),
  rawBySource: v.object({
    v1: v.number(),
    v2: v.number(),
    payment: v.number(),
  }),
  parsedBySource: v.object({
    v1: v.number(),
    v2: v.number(),
    payment: v.number(),
  }),
  refsKeptBySource: v.object({
    v1: v.number(),
    v2: v.number(),
    payment: v.number(),
  }),
  refsDiscardedBySource: v.object({
    v1: v.number(),
    v2: v.number(),
    payment: v.number(),
  }),
  deleted: v.number(),
  inserted: v.number(),
  skipped: v.number(),
  truncationRisk: v.boolean(),
});

/** Registra métricas de auditoría por etapa (fetch/parse/dedup/writes) para diagnóstico de diferencias. */
export const recordCloudwatchIngestionAudit = mutation({
  args: { audit: cloudwatchIngestionAuditValidator },
  handler: async (ctx, { audit }) => {
    const existing = await ctx.db
      .query("cloudwatchIngestionAudit")
      .withIndex("by_date", (q) => q.eq("date", audit.date))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("cloudwatchIngestionAudit", {
      ...audit,
      recordedAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Elimina un lote de registros del mes. Llamar en loop hasta deleted=0. Límite 4096 lecturas. */
export const deletePaymentsByMonth = mutation({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .take(BATCH_READS);
    for (const r of records) {
      await ctx.db.delete(r._id);
    }
    return { deleted: records.length };
  },
});

/** Elimina un lote de registros con importDate = date. Llamar en loop hasta deleted=0. */
export const deletePaymentsByDate = mutation({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const sources = ["v1", "v2", "payment"] as const;
    let deleted = 0;
    for (const source of sources) {
      const records = await ctx.db
        .query("paymentRecords")
        .withIndex("by_source_and_date", (q) =>
          q.eq("logSource", source).eq("importDate", date)
        )
        .take(BATCH_READS);
      for (const r of records) {
        await ctx.db.delete(r._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

const dayEntryValidator = v.object({
  date: v.string(),
  count: v.number(),
  monto: v.number(),
  v1: v.number(),
  v1Monto: v.optional(v.number()),
  v2Monto: v.optional(v.number()),
  paymentMonto: v.optional(v.number()),
  v2: v.number(),
  payment: v.number(),
  byMovimiento: v.array(
    v.object({
      movimiento: v.string(),
      count: v.number(),
      monto: v.number(),
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
    })
  ),
  refs: v.array(v.string()),
});

/** Actualiza monthStats con datos de un día. Reemplaza el día si ya existe. */
export const updateMonthStatsFromDay = mutation({
  args: {
    month: v.string(),
    dayEntry: dayEntryValidator,
  },
  handler: async (ctx, { month, dayEntry }) => {
    const existing = await ctx.db
      .query("monthStats")
      .withIndex("by_month", (q) => q.eq("month", month))
      .first();

    const [year, mon] = month.split("-").map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const emptyDay = (d: number) => ({
      date: `${month}-${String(d).padStart(2, "0")}`,
      count: 0,
      monto: 0,
      v1: 0,
      v2: 0,
      payment: 0,
      v1Monto: 0,
      v2Monto: 0,
      paymentMonto: 0,
    });

    let dayEntries = existing?.dayEntries ?? [];
    dayEntries = dayEntries.filter((e) => e.date !== dayEntry.date);
    dayEntries.push(dayEntry);
    dayEntries.sort((a, b) => a.date.localeCompare(b.date));

    const totalPagos = dayEntries.reduce((s, e) => s + e.count, 0);
    const montoTotal = dayEntries.reduce((s, e) => s + e.monto, 0);
    const allRefs = dayEntries.flatMap((e) => e.refs);
    const referenciasUnicas =
      allRefs.length > 0 ? new Set(allRefs).size : totalPagos;
    const diasConDatos = dayEntries.filter((e) => e.count > 0).length;
    const promedioDiario =
      diasConDatos > 0 ? Math.round(totalPagos / diasConDatos) : 0;

    const porFuente: Record<string, number> = { v1: 0, v2: 0, payment: 0 };
    for (const e of dayEntries) {
      porFuente.v1 += e.v1;
      porFuente.v2 += e.v2;
      porFuente.payment += e.payment;
    }

    const config = await getMovementConfig(ctx);
    const byMovimiento = new Map<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    >();
    for (const e of dayEntries) {
      for (const m of e.byMovimiento) {
        const mov = normalizeWithConfig(m.movimiento, config) || "(sin tipo)";
        const cur = byMovimiento.get(mov) ?? {
          count: 0,
          monto: 0,
          v1: 0,
          v2: 0,
          payment: 0,
        };
        byMovimiento.set(mov, {
          count: cur.count + m.count,
          monto: cur.monto + m.monto,
          v1: cur.v1 + m.v1,
          v2: cur.v2 + m.v2,
          payment: cur.payment + m.payment,
        });
      }
    }

    const montoPorFuente = { v1: 0, v2: 0, payment: 0 };
    for (const e of dayEntries) {
      if (e.count > 0) {
        const ratio = e.monto / e.count;
        montoPorFuente.v1 += e.v1 * ratio;
        montoPorFuente.v2 += e.v2 * ratio;
        montoPorFuente.payment += e.payment * ratio;
      }
    }

    const dailyBreakdown = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      const e = dayEntries.find((x) => x.date === dateStr);
      const entry = e as { v1Monto?: number; v2Monto?: number; paymentMonto?: number } | undefined;
      dailyBreakdown.push(
        e
          ? {
              date: dateStr,
              count: e.count,
              monto: e.monto,
              v1: e.v1,
              v2: e.v2,
              payment: e.payment,
              v1Monto: entry?.v1Monto ?? 0,
              v2Monto: entry?.v2Monto ?? 0,
              paymentMonto: entry?.paymentMonto ?? 0,
            }
          : { ...emptyDay(d), date: dateStr }
      );
    }

    const movementStats = Array.from(byMovimiento.entries())
      .map(([movimiento, data]) => ({ movimiento, ...data }))
      .sort((a, b) => b.count - a.count);

    const sources = ["v1", "v2", "payment"] as const;
    const sourceStats = sources.map((source) => {
      const count = porFuente[source] ?? 0;
      const monto =
        source === "v1"
          ? montoPorFuente.v1
          : source === "v2"
            ? montoPorFuente.v2
            : montoPorFuente.payment;
      return {
        source,
        count,
        monto: Math.round(monto),
        pctCount: totalPagos > 0 ? (count / totalPagos) * 100 : 0,
        pctMonto: montoTotal > 0 ? (monto / montoTotal) * 100 : 0,
      };
    });

    const byDate = dayEntries
      .filter((e) => e.count > 0)
      .map((e) => ({ date: e.date, count: e.count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const dayEntriesForStorage = dayEntries.map(({ refs: _, ...rest }) => ({
      ...rest,
      refs: [],
    }));

    const stats = {
      month,
      dayEntries: dayEntriesForStorage,
      kpis: {
        totalPagos,
        montoTotal,
        referenciasUnicas,
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
      lastUpdated: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, stats);
    } else {
      await ctx.db.insert("monthStats", stats);
    }
  },
});

/** Elimina monthStats de un mes. Llamar al limpiar datos del mes. */
export const deleteMonthStats = mutation({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const existing = await ctx.db
      .query("monthStats")
      .withIndex("by_month", (q) => q.eq("month", month))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { deleted: existing ? 1 : 0 };
  },
});

const monthStatsPayloadValidator = v.object({
  month: v.string(),
  dayEntries: v.array(
    v.object({
      date: v.string(),
      count: v.number(),
      monto: v.number(),
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
      v1Monto: v.optional(v.number()),
      v2Monto: v.optional(v.number()),
      paymentMonto: v.optional(v.number()),
      byMovimiento: v.array(
        v.object({
          movimiento: v.string(),
          count: v.number(),
          monto: v.number(),
          v1: v.number(),
          v2: v.number(),
          payment: v.number(),
        })
      ),
      refs: v.array(v.string()),
    })
  ),
  kpis: v.object({
    totalPagos: v.number(),
    montoTotal: v.number(),
    referenciasUnicas: v.number(),
    promedioDiario: v.number(),
    diasConDatos: v.number(),
    porFuente: v.record(v.string(), v.number()),
  }),
  dailyBreakdown: v.array(
    v.object({
      date: v.string(),
      count: v.number(),
      monto: v.number(),
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
      v1Monto: v.optional(v.number()),
      v2Monto: v.optional(v.number()),
      paymentMonto: v.optional(v.number()),
    })
  ),
  movementStats: v.array(
    v.object({
      movimiento: v.string(),
      count: v.number(),
      monto: v.number(),
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
    })
  ),
  sourceStats: v.array(
    v.object({
      source: v.string(),
      count: v.number(),
      monto: v.number(),
      pctCount: v.number(),
      pctMonto: v.number(),
    })
  ),
  ingestionStatus: v.object({
    totalRecords: v.number(),
    daysWithData: v.number(),
    byDate: v.array(v.object({ date: v.string(), count: v.number() })),
  }),
});

export const setMonthStatsFromAggregation = mutation({
  args: { payload: monthStatsPayloadValidator },
  handler: async (ctx, { payload }) => {
    const existing = await ctx.db
      .query("monthStats")
      .withIndex("by_month", (q) => q.eq("month", payload.month))
      .first();

    const stats = {
      ...payload,
      lastUpdated: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, stats);
    } else {
      await ctx.db.insert("monthStats", stats);
    }
    return { updated: true };
  },
});

export const deletePaymentsByIds = mutation({
  args: { ids: v.array(v.id("paymentRecords")) },
  handler: async (ctx, { ids }) => {
    let deleted = 0;
    for (const id of ids) {
      const doc = await ctx.db.get(id);
      if (doc) {
        await ctx.db.delete(id);
        deleted++;
      }
    }
    return { deleted };
  },
});

export const deletePaymentsByReferencias = mutation({
  args: { referencias: v.array(v.string()) },
  handler: async (ctx, { referencias }) => {
    let deleted = 0;
    for (const ref of referencias) {
      const existing = await ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (existing) {
        await ctx.db.delete(existing._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

const CLOUDWATCH_WATERMARK_KEY = "cloudwatch_watermark";

export const setCloudwatchWatermark = mutation({
  args: { lastSyncedDate: v.string() },
  handler: async (ctx, { lastSyncedDate }) => {
    const existing = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", CLOUDWATCH_WATERMARK_KEY))
      .first();
    const doc = {
      key: CLOUDWATCH_WATERMARK_KEY,
      lastCompleteDay: 0,
      lastProcessedTimestamp: lastSyncedDate,
      year: 0,
      month: 0,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert("processingControl", doc);
    }
    return { ok: true };
  },
});

export const clearCloudwatchWatermark = mutation({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", CLOUDWATCH_WATERMARK_KEY))
      .first();
    if (doc) await ctx.db.delete(doc._id);
    return { ok: true };
  },
});

// ─── Tablas copia fiel por fuente (determinístico) ───

const sourceRecordValidator = v.object({
  importDate: v.string(),
  importMonth: v.string(),
  timestamp: v.string(),
  referencia: v.string(),
  monto: v.number(),
  fechaTransaccion: v.string(),
  estatus: v.string(),
  movimiento: v.string(),
  tramiteId: v.optional(v.number()),
  rawData: v.optional(v.string()),
});

/** Elimina un lote de registros de cloudwatchSourceV1 por importDate. Llamar en loop hasta deleted=0. */
export const deleteCloudwatchSourceV1ByDate = mutation({
  args: { importDate: v.string() },
  handler: async (ctx, { importDate }) => {
    const records = await ctx.db
      .query("cloudwatchSourceV1")
      .withIndex("by_importDate", (q) => q.eq("importDate", importDate))
      .take(BATCH_READS);
    for (const r of records) await ctx.db.delete(r._id);
    return { deleted: records.length };
  },
});

/** Elimina un lote de registros de cloudwatchSourceV2 por importDate. Llamar en loop hasta deleted=0. */
export const deleteCloudwatchSourceV2ByDate = mutation({
  args: { importDate: v.string() },
  handler: async (ctx, { importDate }) => {
    const records = await ctx.db
      .query("cloudwatchSourceV2")
      .withIndex("by_importDate", (q) => q.eq("importDate", importDate))
      .take(BATCH_READS);
    for (const r of records) await ctx.db.delete(r._id);
    return { deleted: records.length };
  },
});

/** Elimina un lote de registros de cloudwatchSourcePayment por importDate. Llamar en loop hasta deleted=0. */
export const deleteCloudwatchSourcePaymentByDate = mutation({
  args: { importDate: v.string() },
  handler: async (ctx, { importDate }) => {
    const records = await ctx.db
      .query("cloudwatchSourcePayment")
      .withIndex("by_importDate", (q) => q.eq("importDate", importDate))
      .take(BATCH_READS);
    for (const r of records) await ctx.db.delete(r._id);
    return { deleted: records.length };
  },
});

/** Inserta un lote en cloudwatchSourceV1. Idempotencia: borrar por importDate antes de recargar. */
export const ingestCloudwatchSourceV1Batch = mutation({
  args: { records: v.array(sourceRecordValidator) },
  handler: async (ctx, { records }) => {
    let inserted = 0;
    for (const rec of records) {
      await ctx.db.insert("cloudwatchSourceV1", {
        ...rec,
        logSource: "v1",
      });
      inserted++;
    }
    return { inserted };
  },
});

/** Inserta un lote en cloudwatchSourceV2. Idempotencia: borrar por importDate antes de recargar. */
export const ingestCloudwatchSourceV2Batch = mutation({
  args: { records: v.array(sourceRecordValidator) },
  handler: async (ctx, { records }) => {
    let inserted = 0;
    for (const rec of records) {
      await ctx.db.insert("cloudwatchSourceV2", {
        ...rec,
        logSource: "v2",
      });
      inserted++;
    }
    return { inserted };
  },
});

/** Inserta un lote en cloudwatchSourcePayment. Idempotencia: borrar por importDate antes de recargar. */
export const ingestCloudwatchSourcePaymentBatch = mutation({
  args: { records: v.array(sourceRecordValidator) },
  handler: async (ctx, { records }) => {
    let inserted = 0;
    for (const rec of records) {
      await ctx.db.insert("cloudwatchSourcePayment", {
        ...rec,
        logSource: "payment",
      });
      inserted++;
    }
    return { inserted };
  },
});

/** Programa la acción de consolidación (tablas fuente → paymentRecords) para un rango de fechas. */
export const scheduleConsolidationFromSourceTables = mutation({
  args: {
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { fromDate, toDate }) => {
    await ctx.scheduler.runAfter(0, api.cloudwatchActions.consolidateFromSourceTables, {
      fromDate,
      toDate,
    });
    return { ok: true, fromDate, toDate, message: "Consolidación programada" };
  },
});
