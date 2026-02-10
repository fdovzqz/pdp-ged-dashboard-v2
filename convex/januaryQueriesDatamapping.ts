import { query } from "./_generated/server";
import { v } from "convex/values";
import { getMovementConfig, normalizeWithConfig } from "./movementCodes";

const JANUARY_MONTH = 1;

export const getDailyDataMonthlyTotals = query({
  args: { year: v.number(), month: v.number() },
  handler: async (ctx, { year, month }) => {
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("year"), year), q.eq(q.field("month"), month))
      )
      .collect();
    let events = 0;
    let totalAmount = 0;
    for (const d of daily) {
      events += d.events;
      totalAmount += d.totalAmount ?? 0;
    }
    return { events, totalAmount, daysWithData: daily.length };
  },
});

export const getDailyDataForDays = query({
  args: {
    year: v.number(),
    month: v.number(),
    days: v.array(v.number()),
  },
  handler: async (ctx, { year, month, days }) => {
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("year"), year), q.eq(q.field("month"), month))
      )
      .collect();
    return daily
      .filter((d) => days.includes(d.day))
      .sort((a, b) => a.day - b.day);
  },
});

export const getAvailableMonths = query({
  args: {},
  handler: async (ctx) => {
    const monthly = await ctx.db.query("monthlyDataDatamapping").collect();
    const seen = new Set<string>();
    for (const m of monthly) {
      seen.add(`${m.year}-${String(m.month).padStart(2, "0")}`);
    }
    return Array.from(seen).sort((a, b) => b.localeCompare(a));
  },
});

export const getHistoricalData = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const byDay = new Map<
      number,
      { "2024": number; "2025": number; "2026": number }
    >();
    for (const d of daily) {
      const row = byDay.get(d.day) ?? {
        "2024": 0,
        "2025": 0,
        "2026": 0,
      };
      if (d.year >= 2024 && d.year <= 2026) {
        row[String(d.year) as "2024" | "2025" | "2026"] = d.events;
      }
      byDay.set(d.day, row);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a - b)
      .map(([day, data]) => ({ day, ...data }));
  },
});

export const getLastAvailableDay = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("month"), month), q.eq(q.field("isComplete"), true))
      )
      .collect();
    if (daily.length === 0) return 0;
    return Math.max(...daily.map((d) => d.day));
  },
});

export const getTotals = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const monthly = await ctx.db
      .query("monthlyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const result: Record<string, number> = { "2024": 0, "2025": 0, "2026": 0 };
    for (const m of monthly) {
      if (m.year >= 2024 && m.year <= 2026) {
        result[String(m.year)] = m.events;
      }
    }
    return result;
  },
});

export const getTotalsUpToDay = query({
  args: { maxDay: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { maxDay, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("month"), month), q.lte(q.field("day"), maxDay))
      )
      .collect();
    const result: Record<string, number> = { "2024": 0, "2025": 0, "2026": 0 };
    for (const d of daily) {
      if (d.year >= 2024 && d.year <= 2026) {
        result[String(d.year)] += d.events;
      }
    }
    return result;
  },
});

export const getTotalsAndAmountsUpToDay = query({
  args: { maxDay: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { maxDay, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("month"), month), q.lte(q.field("day"), maxDay))
      )
      .collect();
    const result: Record<string, { events: number; totalAmount: number }> = {};
    for (const y of [2024, 2025, 2026]) {
      result[String(y)] = { events: 0, totalAmount: 0 };
    }
    for (const d of daily) {
      if (d.year >= 2024 && d.year <= 2026) {
        const key = String(d.year);
        result[key].events += d.events;
        result[key].totalAmount += d.totalAmount ?? 0;
      }
    }
    return result;
  },
});

export const getDailyAverages = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daysInMonth = new Date(2024, month, 0).getDate();
    const monthly = await ctx.db
      .query("monthlyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const result: Record<string, number> = { "2024": 0, "2025": 0, "2026": 0 };
    for (const m of monthly) {
      if (m.year >= 2024 && m.year <= 2026) {
        result[String(m.year)] =
          daysInMonth > 0 ? Math.round(m.events / daysInMonth) : 0;
      }
    }
    return result;
  },
});

export const getGrowthMetrics = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const monthly = await ctx.db
      .query("monthlyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const totals: Record<string, number> = { "2024": 0, "2025": 0, "2026": 0 };
    for (const m of monthly) {
      if (m.year >= 2024 && m.year <= 2026) {
        totals[String(m.year)] = m.events;
      }
    }
    const v24 = totals["2024"] ?? 0;
    const v25 = totals["2025"] ?? 0;
    const v26 = totals["2026"] ?? 0;
    const pct = (a: number, b: number) =>
      b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : 0;
    return {
      growth24vs25: pct(v25, v24),
      growth25vs26: pct(v26, v25),
      growth24vs26: pct(v26, v24),
    };
  },
});

export const getHistoricalMax = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    if (daily.length === 0) return { value: 0, day: 0, year: 0 };
    const max = daily.reduce((a, b) => (b.events > a.events ? b : a));
    return { value: max.events, day: max.day, year: max.year };
  },
});

export const getHourlyDistribution = query({
  args: {
    month: v.optional(v.number()),
    dayType: v.optional(v.string()),
  },
  handler: async (ctx, { month: monthArg, dayType: dayTypeArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const dayType = dayTypeArg ?? "weekday";
    const dist = await ctx.db
      .query("hourlyDistributionDatamapping")
      .filter((q) =>
        q.and(
          q.eq(q.field("month"), month),
          q.eq(q.field("dayType"), dayType)
        )
      )
      .collect();
    const byHour = new Map<
      number,
      { hour: number; "2024": number; "2025": number; "2026": number }
    >();
    for (let h = 0; h < 24; h++) {
      byHour.set(h, { hour: h, "2024": 0, "2025": 0, "2026": 0 });
    }
    for (const d of dist) {
      const row = byHour.get(d.hour);
      if (row && d.year >= 2024 && d.year <= 2026) {
        row[String(d.year) as "2024" | "2025" | "2026"] = d.events;
      }
    }
    return Array.from(byHour.values()).sort((a, b) => a.hour - b.hour);
  },
});

export const getHeatmapData = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("year"), year), q.eq(q.field("month"), month))
      )
      .collect();
    const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const byDay = new Map(
      daily.map((d) => [
        d.day,
        {
          day: d.day,
          dayName: DAY_NAMES[new Date(year, month - 1, d.day).getDay()],
          week: Math.ceil(d.day / 7),
          value: d.events,
          year,
        },
      ])
    );
    const daysInMonth = new Date(year, month, 0).getDate();
    const result = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const v = byDay.get(d);
      result.push(
        v ?? {
          day: d,
          dayName: DAY_NAMES[new Date(year, month - 1, d).getDay()],
          week: Math.ceil(d / 7),
          value: 0,
          year,
        }
      );
    }
    return result;
  },
});

export const getWeekdayWeekendStats = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const dist = await ctx.db
      .query("hourlyDistributionDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const byYearType = new Map<
      string,
      { weekday: number; weekend: number }
    >();
    for (const y of [2024, 2025, 2026]) {
      byYearType.set(String(y), { weekday: 0, weekend: 0 });
    }
    for (const d of dist) {
      const key = String(d.year);
      const cur = byYearType.get(key);
      if (cur && d.year >= 2024 && d.year <= 2026) {
        if (d.dayType === "weekday") cur.weekday += d.events;
        else cur.weekend += d.events;
      }
    }
    return Array.from(byYearType.entries()).map(([year, data]) => ({
      year,
      ...data,
    }));
  },
});

export const getWeekdayWeekendStatsWithAmounts = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const byYearType = new Map<
      string,
      {
        weekday: number;
        weekend: number;
        weekdayAmount: number;
        weekendAmount: number;
      }
    >();
    for (const y of [2024, 2025, 2026]) {
      byYearType.set(String(y), {
        weekday: 0,
        weekend: 0,
        weekdayAmount: 0,
        weekendAmount: 0,
      });
    }
    for (const d of daily) {
      if (d.year < 2024 || d.year > 2026) continue;
      const dow = new Date(d.year, month - 1, d.day).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const key = String(d.year);
      const cur = byYearType.get(key);
      if (!cur) continue;
      if (isWeekend) {
        cur.weekend += d.events;
        cur.weekendAmount += d.totalAmount ?? 0;
      } else {
        cur.weekday += d.events;
        cur.weekdayAmount += d.totalAmount ?? 0;
      }
    }
    return Array.from(byYearType.entries()).map(([year, data]) => ({
      year,
      ...data,
    }));
  },
});

export const getPeriodStats = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const byYear = new Map<
      string,
      {
        arranque: number;
        medio: number;
        cierre: number;
        arranqueAmount: number;
        medioAmount: number;
        cierreAmount: number;
      }
    >();
    for (const y of [2024, 2025, 2026]) {
      byYear.set(String(y), {
        arranque: 0,
        medio: 0,
        cierre: 0,
        arranqueAmount: 0,
        medioAmount: 0,
        cierreAmount: 0,
      });
    }
    for (const d of daily) {
      const key = String(d.year);
      const cur = byYear.get(key);
      if (!cur || d.year < 2024 || d.year > 2026) continue;
      const amt = d.totalAmount ?? 0;
      if (d.day <= 7) {
        cur.arranque += d.events;
        cur.arranqueAmount += amt;
      } else if (d.day <= 24) {
        cur.medio += d.events;
        cur.medioAmount += amt;
      } else {
        cur.cierre += d.events;
        cur.cierreAmount += amt;
      }
    }
    return Array.from(byYear.entries()).map(([year, data]) => ({
      year,
      ...data,
    }));
  },
});

export const getAnalysisNotes = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("analysisNotes")
      .withIndex("by_order")
      .order("asc")
      .collect();
  },
});

export const getAmountTotals = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const monthly = await ctx.db
      .query("monthlyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    const result: Record<
      string,
      { totalAmount: number; events: number; ticketPromedio: number }
    > = {};
    for (const m of monthly) {
      if (m.year >= 2024 && m.year <= 2026) {
        const key = String(m.year);
        result[key] = {
          totalAmount: m.totalAmount,
          events: m.events,
          ticketPromedio:
            m.events > 0 ? Math.round(m.totalAmount / m.events) : 0,
        };
      }
    }
    return result;
  },
});

export const getAmountByMovement = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const records = await ctx.db
      .query("amountByMovementDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("year"), year), q.eq(q.field("month"), month))
      )
      .collect();
    const config = await getMovementConfig(ctx);
    const merged = new Map<
      string,
      { movimiento: string; totalAmount: number; count: number }
    >();
    for (const r of records) {
      const key = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
      const cur = merged.get(key) ?? {
        movimiento: key,
        totalAmount: 0,
        count: 0,
      };
      cur.totalAmount += r.totalAmount ?? 0;
      cur.count += r.count ?? 0;
      merged.set(key, cur);
    }
    return Array.from(merged.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount
    );
  },
});

export const getDayDetail = query({
  args: {
    year: v.number(),
    month: v.number(),
    day: v.number(),
  },
  handler: async (ctx, { year, month, day }) => {
    const raw = await ctx.db
      .query("rawHourlyDataDatamapping")
      .filter((q) =>
        q.and(
          q.eq(q.field("year"), year),
          q.eq(q.field("month"), month),
          q.eq(q.field("day"), day)
        )
      )
      .collect();
    const byYear = new Map<
      number,
      Array<{
        hour: number;
        events: number;
        cumulative: number;
        totalAmount: number;
      }>
    >();
    for (const r of raw) {
      const arr = byYear.get(r.year) ?? [];
      const prev = arr[arr.length - 1]?.cumulative ?? 0;
      arr.push({
        hour: r.hour,
        events: r.events,
        cumulative: prev + r.events,
        totalAmount: r.totalAmount ?? 0,
      });
      byYear.set(r.year, arr);
    }
    const result: Record<
      string,
      Array<{
        hour: number;
        events: number;
        cumulative: number;
        totalAmount: number;
      }>
    > = {};
    for (const [y, arr] of byYear) {
      result[String(y)] = arr.sort((a, b) => a.hour - b.hour);
    }
    return result;
  },
});

export const getDailyAmountData = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("year"), year), q.eq(q.field("month"), month))
      )
      .collect();
    return daily
      .sort((a, b) => a.day - b.day)
      .map((d) => ({
        day: d.day,
        events: d.events,
        totalAmount: d.totalAmount ?? 0,
        transactionCount: d.transactionCount ?? d.events,
        ticketPromedio:
          d.events > 0 ? Math.round((d.totalAmount ?? 0) / d.events) : 0,
      }));
  },
});

export const getHeatmapAmountData = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) =>
        q.and(q.eq(q.field("year"), year), q.eq(q.field("month"), month))
      )
      .collect();
    const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const daysInMonth = new Date(year, month, 0).getDate();
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const result = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const v = byDay.get(d);
      result.push({
        day: d,
        dayName: DAY_NAMES[new Date(year, month - 1, d).getDay()],
        week: Math.ceil(d / 7),
        value: v?.events ?? 0,
        amount: v?.totalAmount ?? 0,
        year,
      });
    }
    return result;
  },
});

/** Labels por código de fuente. */
const FUENTE_LABELS: Record<string, string> = {
  EVO: "Motor de Pagos - EVO",
  DEC: "SEI - DEC",
  CODI: "Motor de Pagos - CODI",
  NO_DEFINIDO: "SEI - No Definido",
};

/** EVO (Tarjeta de Crédito) vs Transferencia (DEC + otros) desde datamappingDailySourceBreakdown. Si existe datamappingDailyFuenteBreakdown retorna sources para cards por fuente. */
export const getPaymentChannelStats = query({
  args: {
    month: v.optional(v.number()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, { month: monthArg, year: yearArg }) => {
    const month = monthArg ?? 1;
    const year = yearArg ?? 2026;
    const pad = (n: number) => String(n).padStart(2, "0");

    const fuenteDaily = await ctx.db
      .query("datamappingDailyFuenteBreakdown")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();

    if (fuenteDaily.length > 0) {
      const byFuente = new Map<
        string,
        { count: number; monto: number; byDay: Map<number, { count: number; monto: number }> }
      >();
      for (const d of fuenteDaily) {
        let cur = byFuente.get(d.fuente);
        if (!cur) {
          cur = { count: 0, monto: 0, byDay: new Map() };
          byFuente.set(d.fuente, cur);
        }
        cur.count += d.count;
        cur.monto += d.monto;
        const dayCur = cur.byDay.get(d.day) ?? { count: 0, monto: 0 };
        dayCur.count += d.count;
        dayCur.monto += d.monto;
        cur.byDay.set(d.day, dayCur);
      }
      const totalCount = Array.from(byFuente.values()).reduce((s, v) => s + v.count, 0);
      const totalMonto = Array.from(byFuente.values()).reduce((s, v) => s + v.monto, 0);
      const order = ["EVO", "DEC", "CODI", "NO_DEFINIDO"] as const;
      const sources = order
        .filter((f) => byFuente.has(f))
        .map((fuente) => {
          const v = byFuente.get(fuente)!;
          return {
            fuente,
            label: FUENTE_LABELS[fuente] ?? fuente,
            count: v.count,
            monto: v.monto,
            pctCount: totalCount > 0 ? (v.count / totalCount) * 100 : 0,
            pctMonto: totalMonto > 0 ? (v.monto / totalMonto) * 100 : 0,
            ticketPromedio: v.count > 0 ? Math.round(v.monto / v.count) : 0,
          };
        });
      const days = [...new Set(fuenteDaily.map((d) => d.day))].sort((a, b) => a - b);
      const dailyByChannel = days.map((day) => {
        let evo = 0;
        let ventanilla = 0;
        let evoMonto = 0;
        let ventanillaMonto = 0;
        for (const f of order) {
          const cur = byFuente.get(f);
          const dayData = cur?.byDay.get(day);
          if (dayData) {
            if (f === "EVO") {
              evo += dayData.count;
              evoMonto += dayData.monto;
            } else {
              ventanilla += dayData.count;
              ventanillaMonto += dayData.monto;
            }
          }
        }
        return {
          date: `${year}-${pad(month)}-${pad(day)}`,
          evo,
          ventanilla,
          evoMonto,
          ventanillaMonto,
          total: evo + ventanilla,
          totalMonto: evoMonto + ventanillaMonto,
        };
      });
      const evoAgg = byFuente.get("EVO") ?? { count: 0, monto: 0, byDay: new Map() };
      const ventanillaCount = totalCount - evoAgg.count;
      const ventanillaMonto = totalMonto - evoAgg.monto;
      return {
        evo: {
          count: evoAgg.count,
          monto: evoAgg.monto,
          pctCount: totalCount > 0 ? (evoAgg.count / totalCount) * 100 : 0,
          pctMonto: totalMonto > 0 ? (evoAgg.monto / totalMonto) * 100 : 0,
          ticketPromedio:
            evoAgg.count > 0 ? Math.round(evoAgg.monto / evoAgg.count) : 0,
          label: FUENTE_LABELS.EVO,
        },
        ventanilla: {
          count: ventanillaCount,
          monto: ventanillaMonto,
          pctCount: totalCount > 0 ? (ventanillaCount / totalCount) * 100 : 0,
          pctMonto: totalMonto > 0 ? (ventanillaMonto / totalMonto) * 100 : 0,
          ticketPromedio:
            ventanillaCount > 0
              ? Math.round(ventanillaMonto / ventanillaCount)
              : 0,
          label: "Transferencia + otros",
          v1Count: ventanillaCount,
          v2Count: 0,
          v1Monto: ventanillaMonto,
          v2Monto: 0,
        },
        totalCount,
        totalMonto,
        dailyByChannel,
        sources,
      };
    }

    const daily = await ctx.db
      .query("datamappingDailySourceBreakdown")
      .withIndex("by_year_month_day", (q) =>
        q.eq("year", year).eq("month", month)
      )
      .collect();
    if (daily.length === 0) return null;
    const evoCount = daily.reduce((s, d) => s + d.evoCount, 0);
    const evoMonto = daily.reduce((s, d) => s + d.evoMonto, 0);
    const ventanillaCount = daily.reduce((s, d) => s + d.ventanillaCount, 0);
    const ventanillaMonto = daily.reduce((s, d) => s + d.ventanillaMonto, 0);
    const totalCount = evoCount + ventanillaCount;
    const totalMonto = evoMonto + ventanillaMonto;
    const dailyByChannel = daily
      .sort((a, b) => a.day - b.day)
      .map((d) => ({
        date: `${d.year}-${pad(d.month)}-${pad(d.day)}`,
        evo: d.evoCount,
        ventanilla: d.ventanillaCount,
        evoMonto: d.evoMonto,
        ventanillaMonto: d.ventanillaMonto,
        total: d.evoCount + d.ventanillaCount,
        totalMonto: d.evoMonto + d.ventanillaMonto,
      }));
    return {
      evo: {
        count: evoCount,
        monto: evoMonto,
        pctCount: totalCount > 0 ? (evoCount / totalCount) * 100 : 0,
        pctMonto: totalMonto > 0 ? (evoMonto / totalMonto) * 100 : 0,
        ticketPromedio: evoCount > 0 ? Math.round(evoMonto / evoCount) : 0,
        label: "EVO · Tarjeta de Crédito",
      },
      ventanilla: {
        count: ventanillaCount,
        monto: ventanillaMonto,
        pctCount: totalCount > 0 ? (ventanillaCount / totalCount) * 100 : 0,
        pctMonto: totalMonto > 0 ? (ventanillaMonto / totalMonto) * 100 : 0,
        ticketPromedio:
          ventanillaCount > 0
            ? Math.round(ventanillaMonto / ventanillaCount)
            : 0,
        label: "Transferencia · Depósito en Caja",
        v1Count: ventanillaCount,
        v2Count: 0,
        v1Monto: ventanillaMonto,
        v2Monto: 0,
      },
      totalCount,
      totalMonto,
      dailyByChannel,
    };
  },
});

export const getDayFinancialDetail = query({
  args: {
    year: v.number(),
    month: v.number(),
    day: v.number(),
  },
  handler: async (ctx, { year, month, day }) => {
    const raw = await ctx.db
      .query("rawHourlyDataDatamapping")
      .filter((q) =>
        q.and(
          q.eq(q.field("year"), year),
          q.eq(q.field("month"), month),
          q.eq(q.field("day"), day)
        )
      )
      .collect();
    const totalAmount = raw.reduce((s, r) => s + (r.totalAmount ?? 0), 0);
    const totalEvents = raw.reduce((s, r) => s + r.events, 0);
    const ticketPromedio =
      totalEvents > 0 ? Math.round(totalAmount / totalEvents) : 0;
    return { totalAmount, totalEvents, ticketPromedio };
  },
});
