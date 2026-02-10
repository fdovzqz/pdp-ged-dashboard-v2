import { mutation } from "./_generated/server";
import { v } from "convex/values";
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

/** Fecha YYYY-MM-DD en hora México (UTC-6). Timestamps CloudWatch son UTC. */
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

    // Omitir refs en dayEntries para evitar documento > 1 MiB (límite Convex)
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

/** Reemplaza monthStats con datos agregados. Usado por recreateMonthStatsFromPaymentRecords. */
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

/** Elimina registros por _id. Usar en lotes para evitar límite de escrituras. */
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

/** Elimina registros con estas referencias. Usar antes de insert para reemplazar datos antiguos (p.ej. con importDate incorrecto). */
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

/** Validador para un registro de DynamoDB datamapping (reconciliación Enero 2026). */
const datamappingRecordValidator = v.object({
  referencia: v.string(),
  monto: v.number(),
  fechaPago: v.optional(v.string()),
  fuente: v.optional(v.string()),
  urlPago: v.optional(v.string()),
  tipoMovimiento: v.optional(v.string()),
  updatedAt: v.string(),
  rawJson: v.string(),
});

/**
 * Upserta un lote en datamappingRecords por referencia solamente:
 * si ya existe un doc con esa referencia, se actualiza (latest wins); si no, se inserta.
 * Así, si en DynamoDB actualizan un registro (misma referencia, nuevo updatedAt) no se duplica.
 */
export const upsertDatamappingBatch = mutation({
  args: {
    records: v.array(datamappingRecordValidator),
  },
  handler: async (ctx, { records }) => {
    let inserted = 0;
    let updated = 0;
    for (const rec of records) {
      const existing = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", rec.referencia))
        .first();
      const doc = {
        referencia: rec.referencia,
        monto: rec.monto,
        ...(rec.fechaPago !== undefined ? { fechaPago: rec.fechaPago } : {}),
        ...(rec.fuente !== undefined ? { fuente: rec.fuente } : {}),
        ...(rec.urlPago !== undefined ? { urlPago: rec.urlPago } : {}),
        ...(rec.tipoMovimiento !== undefined
          ? { tipoMovimiento: rec.tipoMovimiento }
          : {}),
        updatedAt: rec.updatedAt,
        rawJson: rec.rawJson,
      };
      if (existing) {
        await ctx.db.patch(existing._id, doc);
        updated += 1;
      } else {
        await ctx.db.insert("datamappingRecords", doc);
        inserted += 1;
      }
    }
    return { inserted, updated };
  },
});

/** Elimina un lote de datamappingRecords (para re-import). Llamar en loop hasta deleted=0. */
const DATAMAPPING_BATCH = 500;

export const deleteDatamappingRecordsBatch = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("datamappingRecords").take(DATAMAPPING_BATCH);
    for (const r of records) {
      await ctx.db.delete(r._id);
    }
    return { deleted: records.length };
  },
});

// --- Reconciliación Enero 2026: tablas de errores (se borran al re-ejecutar) ---

const RECONCILIATION_ERRORS_BATCH = 400;

/** Borra el resumen actual (cualquier scope) y un lote de reconciliationErrors. La action debe llamar en loop hasta deleted < batch size. */
export const clearReconciliationJanuary2026Batch = mutation({
  args: {},
  handler: async (ctx) => {
    const summaries = await ctx.db.query("reconciliationSummary").collect();
    for (const s of summaries) await ctx.db.delete(s._id);
    const batch = await ctx.db.query("reconciliationErrors").take(RECONCILIATION_ERRORS_BATCH);
    for (const r of batch) await ctx.db.delete(r._id);
    return { deleted: batch.length };
  },
});

const reconciliationErrorValidator = v.object({
  kind: v.union(
    v.literal("onlyCw"),
    v.literal("onlyDdb"),
    v.literal("mismatch"),
    v.literal("monthMismatch")
  ),
  referencia: v.string(),
  monto: v.optional(v.number()),
  logSource: v.optional(v.string()),
  montoCloudWatch: v.optional(v.number()),
  montoDynamoDB: v.optional(v.number()),
  importMonth: v.optional(v.string()),
  datamappingUpdatedAt: v.optional(v.string()),
});

/** Inserta un lote en reconciliationErrors. */
export const insertReconciliationErrorsBatch = mutation({
  args: { records: v.array(reconciliationErrorValidator) },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("reconciliationErrors", r);
    }
    return { inserted: records.length };
  },
});

/** Escribe el resumen de la última reconciliación. scopeId: "universe" | "YYYY-MM" | "YYYY-MM::YYYY-MM". Sobrescribe el resumen anterior. */
export const setReconciliationSummaryJanuary2026 = mutation({
  args: {
    scopeId: v.string(),
    matchCount: v.number(),
    onlyCwCount: v.number(),
    onlyDdbCount: v.number(),
    mismatchCount: v.number(),
    monthMismatchCount: v.optional(v.number()),
    totalUnique: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("reconciliationSummary").first();
    const doc = {
      month: args.scopeId,
      runAt: Date.now(),
      matchCount: args.matchCount,
      onlyCwCount: args.onlyCwCount,
      onlyDdbCount: args.onlyDdbCount,
      mismatchCount: args.mismatchCount,
      monthMismatchCount: args.monthMismatchCount ?? 0,
      totalUnique: args.totalUnique,
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("reconciliationSummary", doc);
    return { ok: true };
  },
});
