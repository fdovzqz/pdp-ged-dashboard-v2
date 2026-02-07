import { mutation } from "./_generated/server";
import { v } from "convex/values";

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

export const batchInsertRawHourly = mutation({
  args: {
    records: v.array(rawHourlyValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("rawHourlyData", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertDailyData = mutation({
  args: {
    records: v.array(dailyDataValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("dailyData", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertMonthlyData = mutation({
  args: {
    records: v.array(monthlyDataValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("monthlyData", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertHourlyDistribution = mutation({
  args: {
    records: v.array(hourlyDistributionValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("hourlyDistribution", r);
    }
    return { inserted: records.length };
  },
});

export const batchInsertDailyAmountData = mutation({
  args: {
    records: v.array(dailyAmountValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("dailyAmountData", r);
    }
    return { inserted: records.length };
  },
});

/** Sanitiza movimiento a ASCII (Convex rechaza acentos en index values). */
function toAscii(s: string): string {
  if (typeof s !== "string" || !s) return "";
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "") || "(sin tipo)";
}

export const batchInsertAmountByMovement = mutation({
  args: {
    records: v.array(amountByMovementValidator),
  },
  handler: async (ctx, { records }) => {
    for (const r of records) {
      await ctx.db.insert("amountByMovement", {
        ...r,
        movimiento: toAscii(r.movimiento) || "(sin tipo)",
      });
    }
    return { inserted: records.length };
  },
});

export const clearAggregatesForMonth = mutation({
  args: {
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, { year, month }) => {
    let deleted = 0;

    const rawHourly = await ctx.db
      .query("rawHourlyData")
      .withIndex("by_year_month_day_hour", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of rawHourly) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const daily = await ctx.db
      .query("dailyData")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of daily) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const monthly = await ctx.db
      .query("monthlyData")
      .withIndex("by_year_month", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of monthly) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const hourlyDist = await ctx.db
      .query("hourlyDistribution")
      .withIndex("by_year_month_type_hour", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of hourlyDist) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const dailyAmount = await ctx.db
      .query("dailyAmountData")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of dailyAmount) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    const byMovement = await ctx.db
      .query("amountByMovement")
      .withIndex("by_year_month_movimiento", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    for (const doc of byMovement) {
      await ctx.db.delete(doc._id);
      deleted += 1;
    }

    return { deleted };
  },
});

export const upsertAnalysisNote = mutation({
  args: {
    id: v.string(),
    yearLabel: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    accentColor: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("analysisNotes")
      .filter((q) => q.eq(q.field("id"), args.id))
      .first();

    const doc = {
      yearLabel: args.yearLabel,
      title: args.title,
      content: args.content,
      accentColor: args.accentColor,
      order: args.order,
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    await ctx.db.insert("analysisNotes", { id: args.id, ...doc });
    return null;
  },
});

export const upsertProcessingControl = mutation({
  args: {
    key: v.string(),
    lastCompleteDay: v.number(),
    lastProcessedTimestamp: v.string(),
    year: v.number(),
    month: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastCompleteDay: args.lastCompleteDay,
        lastProcessedTimestamp: args.lastProcessedTimestamp,
        year: args.year,
        month: args.month,
      });
      return existing._id;
    }
    return await ctx.db.insert("processingControl", args);
  },
});
