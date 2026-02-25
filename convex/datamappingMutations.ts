import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { fechaTransaccionToMexicoDate } from "./lib/mexicoDate";

const rawHourlyValidator = v.object({
  year: v.number(),
  month: v.number(),
  day: v.number(),
  hour: v.number(),
  events: v.number(),
  totalAmount: v.number(),
});

const dailyDataValidator = v.object({
  year: v.number(),
  month: v.number(),
  day: v.number(),
  events: v.number(),
  totalAmount: v.number(),
  transactionCount: v.number(),
  isComplete: v.boolean(),
});

const monthlyDataValidator = v.object({
  year: v.number(),
  month: v.number(),
  events: v.number(),
  totalAmount: v.number(),
});

const hourlyDistributionValidator = v.object({
  year: v.number(),
  month: v.number(),
  dayType: v.string(),
  hour: v.number(),
  events: v.number(),
});

const dailyAmountValidator = v.object({
  year: v.number(),
  month: v.number(),
  day: v.number(),
  totalAmount: v.number(),
  transactionCount: v.number(),
});

const amountByMovementValidator = v.object({
  year: v.number(),
  month: v.number(),
  movimiento: v.string(),
  totalAmount: v.number(),
  count: v.number(),
});

const dailySourceBreakdownValidator = v.object({
  year: v.number(),
  month: v.number(),
  day: v.number(),
  evoCount: v.number(),
  evoMonto: v.number(),
  ventanillaCount: v.number(),
  ventanillaMonto: v.number(),
});

const dailyFuenteBreakdownValidator = v.object({
  year: v.number(),
  month: v.number(),
  day: v.number(),
  fuente: v.string(),
  count: v.number(),
  monto: v.number(),
});

export const batchInsertRawHourlyDatamapping = mutation({
  args: {
    records: v.array(rawHourlyValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("rawHourlyDataDatamapping", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertDailyDataDatamapping = mutation({
  args: {
    records: v.array(dailyDataValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("dailyDataDatamapping", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertMonthlyDataDatamapping = mutation({
  args: {
    records: v.array(monthlyDataValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("monthlyDataDatamapping", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertHourlyDistributionDatamapping = mutation({
  args: {
    records: v.array(hourlyDistributionValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("hourlyDistributionDatamapping", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertDailyAmountDataDatamapping = mutation({
  args: {
    records: v.array(dailyAmountValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("dailyAmountDataDatamapping", r);
    }
    return { inserted: records.length };
  },
});

function toAscii(s: string): string {
  if (typeof s !== "string" || !s) return "";
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "") || "(sin tipo)"
  );
}

export const batchInsertAmountByMovementDatamapping = mutation({
  args: {
    records: v.array(amountByMovementValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("amountByMovementDatamapping", {
        ...r,
        movimiento: toAscii(r.movimiento) || "(sin tipo)",
      });
    }
    return { inserted: records.length };
  },
});

export const batchInsertDailySourceBreakdown = mutation({
  args: {
    records: v.array(dailySourceBreakdownValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("datamappingDailySourceBreakdown", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertDailyFuenteBreakdown = mutation({
  args: {
    records: v.array(dailyFuenteBreakdownValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("datamappingDailyFuenteBreakdown", r);
    }
    return { inserted: records.length };
  },
});

/** Limpia solo las tablas de agregación DataMapping para un mes. */
export const clearDatamappingAggregatesForMonth = mutation({
  args: {
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, { year, month }) => {
    let deleted = 0;

    const rawHourly = await ctx.db
      .query("rawHourlyDataDatamapping")
      .withIndex("by_year_month_day_hour", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of rawHourly) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of daily) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const monthly = await ctx.db
      .query("monthlyDataDatamapping")
      .withIndex("by_year_month", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of monthly) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const hourlyDist = await ctx.db
      .query("hourlyDistributionDatamapping")
      .withIndex("by_year_month_type_hour", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of hourlyDist) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const dailyAmount = await ctx.db
      .query("dailyAmountDataDatamapping")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of dailyAmount) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const byMovement = await ctx.db
      .query("amountByMovementDatamapping")
      .withIndex("by_year_month_movimiento", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of byMovement) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const dailySource = await ctx.db
      .query("datamappingDailySourceBreakdown")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of dailySource) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const dailyFuente = await ctx.db
      .query("datamappingDailyFuenteBreakdown")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of dailyFuente) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    return { deleted };
  },
});

// --- datamappingRecords, watermarks, ingestion stats (movidos desde mutations.ts) ---

function dateStrFromUpdatedAt(updatedAt: string): string {
  return updatedAt.includes("T") ? updatedAt.slice(0, 10) : updatedAt.slice(0, 10);
}

const datamappingRecordValidator = v.object({
  transactionId: v.string(),
  referencia: v.string(),
  monto: v.number(),
  fechaPago: v.optional(v.string()),
  fuente: v.optional(v.string()),
  urlPago: v.optional(v.string()),
  tipoMovimiento: v.optional(v.string()),
  updatedAt: v.string(),
  rawJson: v.string(),
  rfc: v.optional(v.string()),
  placa: v.optional(v.string()),
  evoId: v.optional(v.string()),
  codiId: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  folioNumber: v.optional(v.string()),
  loteId: v.optional(v.string()),
  procedureCategory: v.optional(v.string()),
  tramiteId: v.optional(v.string()),
  userId: v.optional(v.string()),
  status: v.optional(v.string()),
  enrichmentExtracted: v.optional(v.boolean()),
});

export const upsertDatamappingBatch = mutation({
  args: {
    records: v.array(datamappingRecordValidator),
    skipStatsUpdate: v.optional(v.boolean()),
  },
  handler: async (ctx, { records, skipStatsUpdate }) => {
    let inserted = 0;
    let updated = 0;
    const statsDeltas: { date: string; delta: number }[] = [];
    for (const rec of records) {
      const existing = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_transactionId", (q) =>
          q.eq("transactionId", rec.transactionId)
        )
        .first();
      const newDate = dateStrFromUpdatedAt(rec.updatedAt);
      const rfcVal =
        rec.rfc !== undefined
          ? (String(rec.rfc).trim() === "" ? "" : String(rec.rfc).trim().toUpperCase())
          : undefined;
      const doc = {
        transactionId: rec.transactionId,
        referencia: rec.referencia,
        monto: rec.monto,
        ...(rec.fechaPago !== undefined ? { fechaPago: rec.fechaPago } : {}),
        ...(rec.fuente !== undefined ? { fuente: rec.fuente } : {}),
        ...(rec.urlPago !== undefined ? { urlPago: rec.urlPago } : {}),
        ...(rec.tipoMovimiento !== undefined ? { tipoMovimiento: rec.tipoMovimiento } : {}),
        updatedAt: rec.updatedAt,
        rawJson: rec.rawJson,
        enrichmentExtracted: rec.enrichmentExtracted ?? false,
        ...(rfcVal !== undefined ? { rfc: rfcVal } : {}),
        ...(rec.placa !== undefined ? { placa: rec.placa } : {}),
        ...(rec.evoId !== undefined ? { evoId: rec.evoId } : {}),
        ...(rec.codiId !== undefined ? { codiId: rec.codiId } : {}),
        ...(rec.expirationDate !== undefined ? { expirationDate: rec.expirationDate } : {}),
        ...(rec.folioNumber !== undefined ? { folioNumber: rec.folioNumber } : {}),
        ...(rec.loteId !== undefined ? { loteId: rec.loteId } : {}),
        ...(rec.procedureCategory !== undefined ? { procedureCategory: rec.procedureCategory } : {}),
        ...(rec.tramiteId !== undefined ? { tramiteId: rec.tramiteId } : {}),
        ...(rec.userId !== undefined ? { userId: rec.userId } : {}),
        ...(rec.status !== undefined ? { status: rec.status } : {}),
      };
      if (existing) {
        const oldDate = dateStrFromUpdatedAt(existing.updatedAt);
        if (oldDate.length >= 10) statsDeltas.push({ date: oldDate, delta: -1 });
        statsDeltas.push({ date: newDate, delta: 1 });
        await ctx.db.patch(existing._id, doc);
        updated += 1;
      } else {
        await ctx.db.insert("datamappingRecords", doc);
        if (newDate.length >= 10) statsDeltas.push({ date: newDate, delta: 1 });
        inserted += 1;
      }
    }
    if (statsDeltas.length > 0 && !skipStatsUpdate) {
      const current = await ctx.db.query("datamappingIngestionStats").first();
      const next = applyDatamappingIngestionDeltas(
        current ? { total: current.total, byYear: current.byYear, byMonth: current.byMonth, byDay: current.byDay } : null,
        statsDeltas
      );
      const statsDoc = { ...next, lastUpdated: Date.now() };
      if (current) await ctx.db.replace(current._id, statsDoc);
      else await ctx.db.insert("datamappingIngestionStats", statsDoc);
      await applyDatamappingMonthStatsDeltas(ctx, statsDeltas);
    }
    return { inserted, updated };
  },
});

const patchDatamappingEnrichmentUpdateValidator = v.object({
  id: v.id("datamappingRecords"),
  rfc: v.string(),
  placa: v.optional(v.string()),
  evoId: v.optional(v.string()),
  codiId: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  folioNumber: v.optional(v.string()),
  loteId: v.optional(v.string()),
  procedureCategory: v.optional(v.string()),
  tramiteId: v.optional(v.string()),
  userId: v.optional(v.string()),
  status: v.optional(v.string()),
  fuente: v.optional(v.string()),
});

export const patchDatamappingRfcBatch = mutation({
  args: {
    updates: v.array(patchDatamappingEnrichmentUpdateValidator),
  },
  handler: async (ctx, { updates }) => {
    for (const u of updates) {
      const trimmed = u.rfc.trim();
      const patch: Record<string, unknown> = {
        rfc: trimmed === "" ? "" : trimmed.toUpperCase(),
        enrichmentExtracted: true,
      };
      const optionalKeys = [
        "placa", "evoId", "codiId", "expirationDate", "folioNumber",
        "loteId", "procedureCategory", "tramiteId", "userId", "status", "fuente",
      ] as const;
      for (const k of optionalKeys) {
        const val = u[k];
        if (val !== undefined && val !== null) patch[k] = val;
      }
      await ctx.db.patch(u.id, patch);
    }
    return { patched: updates.length };
  },
});

export const patchDatamappingFechaTransaccionBatch = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("datamappingRecords"),
        fechaTransaccion: v.string(),
      })
    ),
  },
  handler: async (ctx, { updates }) => {
    for (const { id, fechaTransaccion } of updates) {
      const fechaTransaccionMexico = fechaTransaccionToMexicoDate(fechaTransaccion);
      await ctx.db.patch(id, {
        fechaTransaccion,
        ...(fechaTransaccionMexico ? { fechaTransaccionMexico } : {}),
      });
    }
    return { patched: updates.length };
  },
});

export const patchDatamappingFechaTransaccionMexicoBatch = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("datamappingRecords"),
        fechaTransaccionMexico: v.string(),
      })
    ),
  },
  handler: async (ctx, { updates }) => {
    for (const { id, fechaTransaccionMexico } of updates) {
      await ctx.db.patch(id, { fechaTransaccionMexico });
    }
    return { patched: updates.length };
  },
});

export const backfillDatamappingEnrichmentExtractedBatch = mutation({
  args: {
    updates: v.array(v.object({
      id: v.id("datamappingRecords"),
      enrichmentExtracted: v.boolean(),
    })),
  },
  handler: async (ctx, { updates }) => {
    for (const { id, enrichmentExtracted } of updates) {
      await ctx.db.patch(id, { enrichmentExtracted, rfcExtracted: undefined });
    }
    return { patched: updates.length };
  },
});

const rfcEnrichmentContinueStateValidator = v.optional(
  v.union(
    v.object({
      tipoMovIndex: v.number(),
      cursor: v.union(v.string(), v.null()),
      tipoMovOrder: v.array(v.string()),
    }),
    v.object({
      cursor: v.union(v.string(), v.null()),
      updatedAtFrom: v.string(),
      updatedAtTo: v.string(),
    })
  )
);

export const updateRfcEnrichmentRun = mutation({
  args: {
    runId: v.id("rfcEnrichmentRuns"),
    status: v.union(
      v.literal("completed"),
      v.literal("timed_out"),
      v.literal("error")
    ),
    processed: v.optional(v.number()),
    enriched: v.optional(v.number()),
    message: v.optional(v.string()),
    continueState: rfcEnrichmentContinueStateValidator,
  },
  handler: async (ctx, { runId, ...updates }) => {
    await ctx.db.patch(runId, {
      ...updates,
      completedAt: Date.now(),
    });
  },
});

export const insertRfcInvestigationResults = mutation({
  args: {
    fromDate: v.string(),
    toDate: v.string(),
    matchCount: v.number(),
    matches: v.array(
      v.object({
        rfc: v.string(),
        referencia: v.string(),
        monto: v.number(),
        updatedAt: v.string(),
        tipoMovimiento: v.optional(v.string()),
        fuente: v.optional(v.string()),
        status: v.optional(v.string()),
        loteId: v.optional(v.string()),
        tramiteId: v.optional(v.string()),
        reciboPagoUrl: v.optional(v.string()),
        referenciaPagoUrl: v.optional(v.string()),
        endMonth: v.optional(v.string()),
        declarationType: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { fromDate, toDate, matchCount, matches }) => {
    await ctx.db.insert("rfcInvestigationResults", {
      runAt: Date.now(),
      fromDate,
      toDate,
      matchCount,
      matches,
    });
    return { ok: true };
  },
});

const DATAMAPPING_WATERMARK_KEY = "datamapping_watermark";

export const setDatamappingWatermark = mutation({
  args: { lastUpdatedAt: v.string() },
  handler: async (ctx, { lastUpdatedAt }) => {
    const existing = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", DATAMAPPING_WATERMARK_KEY))
      .first();
    const doc = {
      key: DATAMAPPING_WATERMARK_KEY,
      lastCompleteDay: 0,
      lastProcessedTimestamp: lastUpdatedAt,
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

export const clearDatamappingWatermark = mutation({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", DATAMAPPING_WATERMARK_KEY))
      .first();
    if (doc) await ctx.db.delete(doc._id);
    return { ok: true };
  },
});

const DATAMAPPING_BATCH = 2000;

export const deleteDatamappingRecordsBatch = mutation({
  args: {},
  handler: async (ctx) => {
    const records = await ctx.db.query("datamappingRecords").take(DATAMAPPING_BATCH);
    const statsDeltas: { date: string; delta: number }[] = [];
    for (const r of records) {
      const d = dateStrFromUpdatedAt(r.updatedAt);
      if (d.length >= 10) statsDeltas.push({ date: d, delta: -1 });
      await ctx.db.delete(r._id);
    }
    if (statsDeltas.length > 0) {
      const current = await ctx.db.query("datamappingIngestionStats").first();
      const next = applyDatamappingIngestionDeltas(
        current ? { total: current.total, byYear: current.byYear, byMonth: current.byMonth, byDay: current.byDay } : null,
        statsDeltas
      );
      const statsDoc = { ...next, lastUpdated: Date.now() };
      if (current) await ctx.db.replace(current._id, statsDoc);
      else await ctx.db.insert("datamappingIngestionStats", statsDoc);
      await applyDatamappingMonthStatsDeltas(ctx, statsDeltas);
    }
    return { deleted: records.length };
  },
});

async function applyDatamappingMonthStatsDeltas(
  ctx: MutationCtx,
  deltas: { date: string; delta: number }[]
): Promise<void> {
  const monthsAffected = [
    ...new Set(
      deltas.filter((d) => d.date.length >= 10).map((d) => d.date.slice(0, 7))
    ),
  ];
  for (const month of monthsAffected) {
    const monthDeltas = deltas.filter((d) => d.date.startsWith(`${month}-`));
    const existing = await ctx.db
      .query("datamappingMonthStats")
      .withIndex("by_month", (q) => q.eq("month", month))
      .first();
    const byDateMap = new Map<string, number>();
    if (existing) {
      for (const e of existing.byDate) byDateMap.set(e.date, e.count);
    }
    for (const { date, delta } of monthDeltas) {
      if (date.length < 10) continue;
      byDateMap.set(date, Math.max(0, (byDateMap.get(date) ?? 0) + delta));
    }
    const byDateArr = Array.from(byDateMap.entries())
      .filter(([, c]) => c > 0)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const totalRecords = byDateArr.reduce((s, e) => s + e.count, 0);
    const daysWithData = byDateArr.length;
    const doc = {
      month,
      totalRecords,
      daysWithData,
      byDate: byDateArr,
      lastUpdated: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("datamappingMonthStats", doc);
  }
}

function applyDatamappingIngestionDeltas(
  current: { total: number; byYear: { year: string; count: number }[]; byMonth: { month: string; count: number }[]; byDay: { date: string; count: number }[] } | null,
  deltas: { date: string; delta: number }[]
): { total: number; byYear: { year: string; count: number }[]; byMonth: { month: string; count: number }[]; byDay: { date: string; count: number }[] } {
  const byDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byYear = new Map<string, number>();
  if (current) {
    for (const e of current.byDay) byDay.set(e.date, e.count);
    for (const e of current.byMonth) byMonth.set(e.month, e.count);
    for (const e of current.byYear) byYear.set(e.year, e.count);
  }
  let total = current?.total ?? 0;
  for (const { date, delta } of deltas) {
    if (date.length < 10) continue;
    const day = date.slice(0, 10);
    const month = date.slice(0, 7);
    const year = date.slice(0, 4);
    byDay.set(day, Math.max(0, (byDay.get(day) ?? 0) + delta));
    byMonth.set(month, Math.max(0, (byMonth.get(month) ?? 0) + delta));
    byYear.set(year, Math.max(0, (byYear.get(year) ?? 0) + delta));
    total = Math.max(0, total + delta);
  }
  return {
    total,
    byDay: Array.from(byDay.entries()).filter(([, c]) => c > 0).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
    byMonth: Array.from(byMonth.entries()).filter(([, c]) => c > 0).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    byYear: Array.from(byYear.entries()).filter(([, c]) => c > 0).map(([year, count]) => ({ year, count })).sort((a, b) => a.year.localeCompare(b.year)),
  };
}

export const setDatamappingIngestionStats = mutation({
  args: {
    total: v.number(),
    totalPagoValidado: v.optional(v.number()),
    totalPagoValidadoDec: v.optional(v.number()),
    byYear: v.array(v.object({ year: v.string(), count: v.number() })),
    byYearPagoValidado: v.optional(v.array(v.object({ year: v.string(), count: v.number() }))),
    byYearPagoValidadoDec: v.optional(v.array(v.object({ year: v.string(), count: v.number() }))),
    byMonth: v.array(v.object({ month: v.string(), count: v.number() })),
    byMonthPagoValidado: v.optional(v.array(v.object({ month: v.string(), count: v.number() }))),
    byMonthPagoValidadoDec: v.optional(v.array(v.object({ month: v.string(), count: v.number() }))),
    byDay: v.array(v.object({ date: v.string(), count: v.number() })),
    byDayPagoValidado: v.optional(v.array(v.object({ date: v.string(), count: v.number() }))),
    byDayPagoValidadoDec: v.optional(v.array(v.object({ date: v.string(), count: v.number() }))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("datamappingIngestionStats").first();
    const doc = {
      total: args.total,
      totalPagoValidado: args.totalPagoValidado,
      totalPagoValidadoDec: args.totalPagoValidadoDec,
      byYear: args.byYear,
      byYearPagoValidado: args.byYearPagoValidado,
      byYearPagoValidadoDec: args.byYearPagoValidadoDec,
      byMonth: args.byMonth,
      byMonthPagoValidado: args.byMonthPagoValidado,
      byMonthPagoValidadoDec: args.byMonthPagoValidadoDec,
      byDay: args.byDay,
      byDayPagoValidado: args.byDayPagoValidado,
      byDayPagoValidadoDec: args.byDayPagoValidadoDec,
      lastUpdated: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("datamappingIngestionStats", doc);
    return { ok: true };
  },
});

export const clearDatamappingIngestionStats = mutation({
  args: {},
  handler: async (ctx) => {
    const ingestionDocs = await ctx.db.query("datamappingIngestionStats").collect();
    for (const doc of ingestionDocs) {
      await ctx.db.delete(doc._id);
    }
    const monthDocs = await ctx.db.query("datamappingMonthStats").collect();
    for (const doc of monthDocs) {
      await ctx.db.delete(doc._id);
    }
    return { deleted: ingestionDocs.length + monthDocs.length };
  },
});

const datamappingMonthStatsEntryValidator = v.object({
  month: v.string(),
  totalRecords: v.number(),
  totalRecordsPagoValidado: v.optional(v.number()),
  totalRecordsPagoValidadoDec: v.optional(v.number()),
  daysWithData: v.number(),
  byDate: v.array(v.object({ date: v.string(), count: v.number() })),
});

export const replaceAllDatamappingMonthStats = mutation({
  args: {
    months: v.array(datamappingMonthStatsEntryValidator),
  },
  handler: async (ctx, { months }) => {
    const existing = await ctx.db.query("datamappingMonthStats").collect();
    for (const doc of existing) {
      await ctx.db.delete(doc._id);
    }
    const now = Date.now();
    for (const m of months) {
      await ctx.db.insert("datamappingMonthStats", {
        ...m,
        lastUpdated: now,
      });
    }
    return { replaced: months.length };
  },
});

const datamappingMonthStatsByFechaTransaccionEntryValidator = v.object({
  month: v.string(),
  totalRecords: v.number(),
  totalRecordsPagoValidado: v.optional(v.number()),
  totalRecordsPagoValidadoDec: v.optional(v.number()),
  daysWithData: v.number(),
  byDate: v.array(v.object({ date: v.string(), count: v.number() })),
  byDatePagoValidadoDec: v.optional(v.array(v.object({ date: v.string(), count: v.number() }))),
});

export const replaceAllDatamappingMonthStatsByFechaTransaccion = mutation({
  args: {
    months: v.array(datamappingMonthStatsByFechaTransaccionEntryValidator),
  },
  handler: async (ctx, { months }) => {
    const existing = await ctx.db.query("datamappingMonthStatsByFechaTransaccion").collect();
    for (const doc of existing) {
      await ctx.db.delete(doc._id);
    }
    const now = Date.now();
    for (const m of months) {
      await ctx.db.insert("datamappingMonthStatsByFechaTransaccion", {
        ...m,
        lastUpdated: now,
      });
    }
    return { replaced: months.length };
  },
});
