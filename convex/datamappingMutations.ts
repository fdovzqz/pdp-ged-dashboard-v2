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
