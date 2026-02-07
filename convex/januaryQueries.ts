import { query } from "./_generated/server";
import { v } from "convex/values";
import { getMovementConfig, normalizeWithConfig } from "./movementCodes";

const JANUARY_MONTH = 1;

/** Datos históricos diarios por año para comparativa. */
export const getHistoricalData = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();

    const byDay = new Map<
      number,
      { "2024": number; "2025": number; "2026": number }
    >();
    const years = [2024, 2025, 2026] as const;

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

    const days = Array.from(byDay.entries())
      .sort(([a], [b]) => a - b)
      .map(([day, data]) => ({ day, ...data }));
    return days;
  },
});

/** Último día con datos completos. */
export const getLastAvailableDay = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
      .filter((q) =>
        q.and(q.eq(q.field("month"), month), q.eq(q.field("isComplete"), true))
      )
      .collect();
    if (daily.length === 0) return 0;
    return Math.max(...daily.map((d) => d.day));
  },
});

/** Totales por año. */
export const getTotals = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const monthly = await ctx.db
      .query("monthlyData")
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

/** Totales hasta un día específico. */
export const getTotalsUpToDay = query({
  args: { maxDay: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { maxDay, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
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

/** Totales y montos hasta un día específico por año. */
export const getTotalsAndAmountsUpToDay = query({
  args: { maxDay: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { maxDay, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
      .filter((q) =>
        q.and(q.eq(q.field("month"), month), q.lte(q.field("day"), maxDay))
      )
      .collect();

    const result: Record<
      string,
      { events: number; totalAmount: number }
    > = {};
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

/** Promedios diarios por año. */
export const getDailyAverages = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daysInMonth = new Date(2024, month, 0).getDate();
    const monthly = await ctx.db
      .query("monthlyData")
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

/** Crecimiento entre años (%). */
export const getGrowthMetrics = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const monthly = await ctx.db
      .query("monthlyData")
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

/** Máximo histórico (valor, día, año). */
export const getHistoricalMax = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();
    if (daily.length === 0)
      return { value: 0, day: 0, year: 0 };
    const max = daily.reduce((a, b) =>
      b.events > a.events ? b : a
    );
    return { value: max.events, day: max.day, year: max.year };
  },
});

/** Distribución horaria por año y tipo de día. */
export const getHourlyDistribution = query({
  args: {
    month: v.optional(v.number()),
    dayType: v.optional(v.string()),
  },
  handler: async (ctx, { month: monthArg, dayType: dayTypeArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const dayType = dayTypeArg ?? "weekday";
    const dist = await ctx.db
      .query("hourlyDistribution")
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

/** Datos para heatmap (día, día nombre, semana, valor, año). */
export const getHeatmapData = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
      .filter((q) =>
        q.and(q.eq(q.field("year"), year), q.eq(q.field("month"), month))
      )
      .collect();

    const DAY_NAMES = [
      "Dom",
      "Lun",
      "Mar",
      "Mié",
      "Jue",
      "Vie",
      "Sáb",
    ];
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

/** L-V vs S-D por año. */
export const getWeekdayWeekendStats = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const dist = await ctx.db
      .query("hourlyDistribution")
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

/** L-V vs S-D con montos por año. */
export const getWeekdayWeekendStatsWithAmounts = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
      .filter((q) =>
        q.and(q.eq(q.field("month"), month))
      )
      .collect();

    const byYearType = new Map<
      string,
      { weekday: number; weekend: number; weekdayAmount: number; weekendAmount: number }
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

/** Arranque (1-7), Medio (8-24), Cierre (25-31) por año. */
export const getPeriodStats = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();

    const byYear = new Map<
      string,
      { arranque: number; medio: number; cierre: number; arranqueAmount: number; medioAmount: number; cierreAmount: number }
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

/** Notas de análisis ordenadas. */
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

/** Ingresos totales y ticket promedio por año. */
export const getAmountTotals = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const monthly = await ctx.db
      .query("monthlyData")
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

/** Top movimientos por monto para un año. Agrupa por código normalizado. */
export const getAmountByMovement = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const records = await ctx.db
      .query("amountByMovement")
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

/** Detalle horario de un día (con montos). */
export const getDayDetail = query({
  args: {
    year: v.number(),
    month: v.number(),
    day: v.number(),
  },
  handler: async (ctx, { year, month, day }) => {
    const raw = await ctx.db
      .query("rawHourlyData")
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
      Array<{ hour: number; events: number; cumulative: number; totalAmount: number }>
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
      Array<{ hour: number; events: number; cumulative: number; totalAmount: number }>
    > = {};
    for (const [y, arr] of byYear) {
      result[String(y)] = arr.sort((a, b) => a.hour - b.hour);
    }
    return result;
  },
});

/** Datos diarios con monto para evolución del ticket promedio. */
export const getDailyAmountData = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
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

/** Datos de heatmap con montos para modo dual. */
export const getHeatmapAmountData = query({
  args: { year: v.number(), month: v.optional(v.number()) },
  handler: async (ctx, { year, month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const daily = await ctx.db
      .query("dailyData")
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

/** Estadísticas por canal de pago: EVO (payment) vs Ventanilla (v1+v2).
 * Usa exclusivamente monthStats.dayEntries (precalculado) para evitar el límite
 * de 8192 items de Convex en paymentRecords.collect(). */
export const getPaymentChannelStats = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month: monthArg }) => {
    const month = monthArg ?? JANUARY_MONTH;
    const monthKey = `2026-${String(month).padStart(2, "0")}`;

    const doc = await ctx.db
      .query("monthStats")
      .withIndex("by_month", (q) => q.eq("month", monthKey))
      .first();

    if (!doc) return null;

    // Aggregate sourceStats into two channels
    const evoSource = doc.sourceStats.find((s) => s.source === "payment");
    const v1Source = doc.sourceStats.find((s) => s.source === "v1");
    const v2Source = doc.sourceStats.find((s) => s.source === "v2");

    const evo = {
      count: evoSource?.count ?? 0,
      monto: evoSource?.monto ?? 0,
    };
    const ventanilla = {
      count: (v1Source?.count ?? 0) + (v2Source?.count ?? 0),
      monto: (v1Source?.monto ?? 0) + (v2Source?.monto ?? 0),
    };
    const totalCount = evo.count + ventanilla.count;
    const totalMonto = evo.monto + ventanilla.monto;

    // Daily breakdown: dayEntries o dailyBreakdown (fallback si no hay monto por fuente)
    type DayEntry = {
      date: string;
      count: number;
      monto: number;
      v1: number;
      v2: number;
      payment: number;
      v1Monto?: number;
      v2Monto?: number;
      paymentMonto?: number;
    };
    type DailyBreakdownEntry = {
      date: string;
      count: number;
      monto: number;
      v1: number;
      v2: number;
      payment: number;
      v1Monto?: number;
      v2Monto?: number;
      paymentMonto?: number;
    };
    const source = doc.dayEntries?.length
      ? (doc.dayEntries as DayEntry[])
      : (doc.dailyBreakdown as DailyBreakdownEntry[]);
    const rawDaily = source.map((e) => {
      const evoMonto = (e as DayEntry).paymentMonto ?? 0;
      const ventanillaMonto = ((e as DayEntry).v1Monto ?? 0) + ((e as DayEntry).v2Monto ?? 0);
      const hasMontoBySource = evoMonto > 0 || ventanillaMonto > 0;
      return {
        date: e.date,
        evo: e.payment,
        ventanilla: e.v1 + e.v2,
        evoMonto: hasMontoBySource ? evoMonto : 0,
        ventanillaMonto: hasMontoBySource ? ventanillaMonto : 0,
        total: e.count,
        totalMonto: e.monto,
      };
    });
    // Si no hay monto por fuente, estimar proporcionalmente (totalMonto * pct del día)
    const sumRawEvo = rawDaily.reduce((s, d) => s + d.evoMonto, 0);
    const sumRawVent = rawDaily.reduce((s, d) => s + d.ventanillaMonto, 0);
    const needsEstimate = sumRawEvo === 0 && sumRawVent === 0 && totalCount > 0 && totalMonto > 0;
    const dailyByChannel = rawDaily
      .map((d) => {
        if (needsEstimate && d.total > 0) {
          const pctEvo = totalCount > 0 ? d.evo / totalCount : 0;
          const pctVent = totalCount > 0 ? d.ventanilla / totalCount : 0;
          return {
            ...d,
            evoMonto: Math.round(evo.monto * pctEvo),
            ventanillaMonto: Math.round(ventanilla.monto * pctVent),
          };
        }
        return d;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      evo: {
        ...evo,
        pctCount: totalCount > 0 ? (evo.count / totalCount) * 100 : 0,
        pctMonto: totalMonto > 0 ? (evo.monto / totalMonto) * 100 : 0,
        ticketPromedio: evo.count > 0 ? Math.round(evo.monto / evo.count) : 0,
        label: "EVO · Pago en Línea",
      },
      ventanilla: {
        ...ventanilla,
        pctCount: totalCount > 0 ? (ventanilla.count / totalCount) * 100 : 0,
        pctMonto: totalMonto > 0 ? (ventanilla.monto / totalMonto) * 100 : 0,
        ticketPromedio: ventanilla.count > 0 ? Math.round(ventanilla.monto / ventanilla.count) : 0,
        label: "Ventanilla · Bancos y Cajas",
        v1Count: v1Source?.count ?? 0,
        v2Count: v2Source?.count ?? 0,
        v1Monto: v1Source?.monto ?? 0,
        v2Monto: v2Source?.monto ?? 0,
      },
      totalCount,
      totalMonto,
      dailyByChannel,
    };
  },
});

/** Detalle financiero de un día (top movimientos). */
export const getDayFinancialDetail = query({
  args: {
    year: v.number(),
    month: v.number(),
    day: v.number(),
  },
  handler: async (ctx, { year, month, day }) => {
    const raw = await ctx.db
      .query("rawHourlyData")
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
    const ticketPromedio = totalEvents > 0 ? Math.round(totalAmount / totalEvents) : 0;

    return { totalAmount, totalEvents, ticketPromedio };
  },
});
