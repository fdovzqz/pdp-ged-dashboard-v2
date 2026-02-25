import { mutation } from "./_generated/server";
import { v } from "convex/values";

const RECONCILIATION_ERRORS_BATCH = 400;

/** Borra el resumen actual y un lote de reconciliationErrors. La action debe llamar en loop hasta deleted < batch size. */
export const clearReconciliationBatch = mutation({
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

export const insertReconciliationErrorsBatch = mutation({
  args: { records: v.array(reconciliationErrorValidator) },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("reconciliationErrors", r);
    }
    return { inserted: records.length };
  },
});

/** scopeId: "universe" | "YYYY-MM" | "YYYY-MM::YYYY-MM". Sobrescribe el resumen anterior. */
export const setReconciliationSummary = mutation({
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
