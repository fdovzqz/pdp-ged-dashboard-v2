import { query } from "./_generated/server";
import { v } from "convex/values";

const YEARS = [2024, 2025, 2026] as const;

/** Desglose mensual por año: events y totalAmount para cada mes 1-12. */
export const getMonthlyBreakdown = query({
  args: {},
  handler: async (ctx) => {
    const monthly = await ctx.db.query("monthlyDataDatamapping").collect();

    const byYearMonth = new Map<string, { events: number; totalAmount: number }>();
    for (const m of monthly) {
      const key = `${m.year}-${m.month}`;
      byYearMonth.set(key, { events: m.events, totalAmount: m.totalAmount });
    }

    const result: Array<{
      month: number;
      "2024_events": number;
      "2024_amount": number;
      "2025_events": number;
      "2025_amount": number;
      "2026_events": number;
      "2026_amount": number;
    }> = [];

    for (let m = 1; m <= 12; m++) {
      const row: Record<string, number> = { month: m };
      for (const y of YEARS) {
        const data = byYearMonth.get(`${y}-${m}`);
        row[`${y}_events`] = data?.events ?? 0;
        row[`${y}_amount`] = data?.totalAmount ?? 0;
      }
      result.push(row as (typeof result)[number]);
    }
    return result;
  },
});

/** KPIs anuales: totales, promedios, ticket promedio por año. */
export const getAnnualKPIs = query({
  args: {},
  handler: async (ctx) => {
    const monthly = await ctx.db.query("monthlyDataDatamapping").collect();

    const byYear = new Map<
      number,
      { events: number; totalAmount: number; monthsWithData: number }
    >();
    for (const y of YEARS) {
      byYear.set(y, { events: 0, totalAmount: 0, monthsWithData: 0 });
    }
    for (const m of monthly) {
      const cur = byYear.get(m.year);
      if (!cur) continue;
      cur.events += m.events;
      cur.totalAmount += m.totalAmount;
      if (m.events > 0) cur.monthsWithData += 1;
    }

    const result: Record<
      string,
      {
        events: number;
        totalAmount: number;
        monthsWithData: number;
        avgMonthly: number;
        avgMonthlyAmount: number;
        ticketPromedio: number;
      }
    > = {};

    for (const [y, data] of byYear) {
      const divisor = data.monthsWithData || 1;
      result[String(y)] = {
        ...data,
        avgMonthly: Math.round(data.events / divisor),
        avgMonthlyAmount: Math.round(data.totalAmount / divisor),
        ticketPromedio:
          data.events > 0 ? Math.round(data.totalAmount / data.events) : 0,
      };
    }
    return result;
  },
});

/** Crecimiento interanual por métricas clave. */
export const getYearOverYearGrowth = query({
  args: {},
  handler: async (ctx) => {
    const monthly = await ctx.db.query("monthlyDataDatamapping").collect();

    const totals = new Map<number, { events: number; totalAmount: number }>();
    for (const y of YEARS) {
      totals.set(y, { events: 0, totalAmount: 0 });
    }
    for (const m of monthly) {
      const cur = totals.get(m.year);
      if (!cur) continue;
      cur.events += m.events;
      cur.totalAmount += m.totalAmount;
    }

    const pct = (a: number, b: number): number =>
      b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : 0;

    const v24 = totals.get(2024)!;
    const v25 = totals.get(2025)!;
    const v26 = totals.get(2026)!;

    return {
      events: {
        "2024vs2025": pct(v25.events, v24.events),
        "2025vs2026": pct(v26.events, v25.events),
        "2024vs2026": pct(v26.events, v24.events),
      },
      amount: {
        "2024vs2025": pct(v25.totalAmount, v24.totalAmount),
        "2025vs2026": pct(v26.totalAmount, v25.totalAmount),
        "2024vs2026": pct(v26.totalAmount, v24.totalAmount),
      },
      totals: {
        "2024": v24,
        "2025": v25,
        "2026": v26,
      },
    };
  },
});

/** Mes con mayor/menor volumen por año. */
export const getAnnualExtremes = query({
  args: {},
  handler: async (ctx) => {
    const monthly = await ctx.db.query("monthlyDataDatamapping").collect();

    const result: Record<
      string,
      {
        bestMonth: { month: number; events: number; totalAmount: number };
        worstMonth: { month: number; events: number; totalAmount: number };
      }
    > = {};

    for (const y of YEARS) {
      const yearData = monthly.filter((m) => m.year === y && m.events > 0);
      if (yearData.length === 0) {
        result[String(y)] = {
          bestMonth: { month: 0, events: 0, totalAmount: 0 },
          worstMonth: { month: 0, events: 0, totalAmount: 0 },
        };
        continue;
      }
      const best = yearData.reduce((a, b) => (b.events > a.events ? b : a));
      const worst = yearData.reduce((a, b) => (b.events < a.events ? b : a));
      result[String(y)] = {
        bestMonth: {
          month: best.month,
          events: best.events,
          totalAmount: best.totalAmount,
        },
        worstMonth: {
          month: worst.month,
          events: worst.events,
          totalAmount: worst.totalAmount,
        },
      };
    }
    return result;
  },
});

/** Comparativo mensual detallado: para un mes dado, datos diarios de todos los años. */
export const getMonthComparisonDaily = query({
  args: { month: v.number() },
  handler: async (ctx, { month }) => {
    const daily = await ctx.db
      .query("dailyDataDatamapping")
      .filter((q) => q.eq(q.field("month"), month))
      .collect();

    const maxDay = new Date(2026, month, 0).getDate();
    const result: Array<Record<string, number>> = [];

    for (let d = 1; d <= maxDay; d++) {
      const row: Record<string, number> = { day: d };
      for (const y of YEARS) {
        const found = daily.find((r) => r.year === y && r.day === d);
        row[`${y}_events`] = found?.events ?? 0;
        row[`${y}_amount`] = found?.totalAmount ?? 0;
      }
      result.push(row);
    }
    return result;
  },
});

/** Tendencia acumulada mensual por año (para gráfica de líneas acumuladas). */
export const getAnnualCumulative = query({
  args: {},
  handler: async (ctx) => {
    const monthly = await ctx.db.query("monthlyDataDatamapping").collect();

    const byYearMonth = new Map<string, { events: number; totalAmount: number }>();
    for (const m of monthly) {
      byYearMonth.set(`${m.year}-${m.month}`, {
        events: m.events,
        totalAmount: m.totalAmount,
      });
    }

    const result: Array<Record<string, number>> = [];
    const acc: Record<number, { events: number; amount: number }> = {};
    for (const y of YEARS) {
      acc[y] = { events: 0, amount: 0 };
    }

    for (let m = 1; m <= 12; m++) {
      const row: Record<string, number> = { month: m };
      for (const y of YEARS) {
        const data = byYearMonth.get(`${y}-${m}`);
        acc[y].events += data?.events ?? 0;
        acc[y].amount += data?.totalAmount ?? 0;
        row[`${y}_cumEvents`] = acc[y].events;
        row[`${y}_cumAmount`] = acc[y].amount;
      }
      result.push(row);
    }
    return result;
  },
});

/** Labels por código de fuente (mismo que mensual). */
const FUENTE_LABELS: Record<string, string> = {
  EVO: "Motor de Pagos - EVO",
  DEC: "SEI - DEC",
  CODI: "Motor de Pagos - CODI",
  MIT: "Motor de Pagos - MIT",
  NO_DEFINIDO: "SEI - No Definido",
};

const FUENTE_ORDER = ["EVO", "DEC", "CODI", "MIT", "NO_DEFINIDO"] as const;

type SourceRow = {
  fuente: string;
  label: string;
  count: number;
  monto: number;
  pctCount: number;
  pctMonto: number;
  ticketPromedio: number;
};

/** Pagos por tipo de fuente agregados por año (solo DataMapping). SPEI se agrupa con NO_DEFINIDO. */
export const getAnnualPaymentBySource = query({
  args: {},
  handler: async (ctx): Promise<{
    byYear: Record<string, SourceRow[]>;
    totals: SourceRow[];
  }> => {
    const byYear: Record<string, SourceRow[]> = {
      "2024": [],
      "2025": [],
      "2026": [],
    };

    for (const year of YEARS) {
      const rows = await ctx.db
        .query("datamappingDailyFuenteBreakdown")
        .withIndex("by_year_month_day", (q) => q.eq("year", year))
        .collect();

      const byFuente = new Map<string, { count: number; monto: number }>();
      for (const r of rows) {
        const key = r.fuente === "SPEI" ? "NO_DEFINIDO" : r.fuente;
        const cur = byFuente.get(key) ?? { count: 0, monto: 0 };
        cur.count += r.count;
        cur.monto += r.monto;
        byFuente.set(key, cur);
      }

      const totalCount = [...byFuente.values()].reduce((s, v) => s + v.count, 0);
      const totalMonto = [...byFuente.values()].reduce((s, v) => s + v.monto, 0);

      const sources: SourceRow[] = FUENTE_ORDER.filter((f) => byFuente.has(f)).map(
        (fuente) => {
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
        }
      );
      byYear[String(year)] = sources;
    }

    const totalsByFuente = new Map<string, { count: number; monto: number }>();
    for (const year of YEARS) {
      for (const row of byYear[String(year)]) {
        const cur = totalsByFuente.get(row.fuente) ?? { count: 0, monto: 0 };
        cur.count += row.count;
        cur.monto += row.monto;
        totalsByFuente.set(row.fuente, cur);
      }
    }
    const totalCount = [...totalsByFuente.values()].reduce((s, v) => s + v.count, 0);
    const totalMonto = [...totalsByFuente.values()].reduce((s, v) => s + v.monto, 0);

    const totals: SourceRow[] = FUENTE_ORDER.filter((f) => totalsByFuente.has(f)).map(
      (fuente) => {
        const v = totalsByFuente.get(fuente)!;
        return {
          fuente,
          label: FUENTE_LABELS[fuente] ?? fuente,
          count: v.count,
          monto: v.monto,
          pctCount: totalCount > 0 ? (v.count / totalCount) * 100 : 0,
          pctMonto: totalMonto > 0 ? (v.monto / totalMonto) * 100 : 0,
          ticketPromedio: v.count > 0 ? Math.round(v.monto / v.count) : 0,
        };
      }
    );

    return { byYear, totals };
  },
});
