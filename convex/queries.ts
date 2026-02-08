import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  getMovementConfig,
  normalizeWithConfig,
} from "./movementCodes";

/** Límite Convex: 8192 items por retorno. Clamp para paginación reactiva. */
const MAX_PAGE_ITEMS = 1000;

/** Lee estadísticas precalculadas del mes (tabla monthStats). Eficiente, sin agregar paymentRecords. */
export const getMonthStats = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const doc = await ctx.db
      .query("monthStats")
      .withIndex("by_month", (q) => q.eq("month", month))
      .first();
    if (!doc) return null;
    return {
      kpis: doc.kpis,
      dailyBreakdown: { month: doc.month, days: doc.dailyBreakdown },
      movementStats: { month: doc.month, byMovimiento: doc.movementStats },
      sourceStats: {
        month: doc.month,
        totalPagos: doc.kpis.totalPagos,
        montoTotal: doc.kpis.montoTotal,
        sources: doc.sourceStats,
      },
      ingestionStatus: {
        month: doc.month,
        ...doc.ingestionStatus,
      },
    };
  },
});

/** Resumen de todos los meses con datos (para grilla de Registros Cargados). */
export const getAllMonthsStatus = query({
  args: {},
  handler: async (ctx) => {
    const allStats = await ctx.db.query("monthStats").collect();
    return allStats.map((s) => ({
      month: s.month,
      totalRecords: s.ingestionStatus.totalRecords,
      daysWithData: s.ingestionStatus.daysWithData,
      lastUpdated: s.lastUpdated,
    }));
  },
});

/** Query paginada para evitar límite de retorno (8192 items). Usar en Detalle. */
export const getPaymentsByMonthPaginated = query({
  args: {
    month: v.string(),
    paginationOpts: paginationOptsValidator,
    source: v.optional(
      v.union(v.literal("v1"), v.literal("v2"), v.literal("payment"))
    ),
  },
  handler: async (ctx, { month, paginationOpts, source }) => {
    const safeOpts = {
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, MAX_PAGE_ITEMS),
    };
    if (source) {
      return await ctx.db
        .query("paymentRecords")
        .withIndex("by_source_month_referencia", (q) =>
          q.eq("logSource", source).eq("importMonth", month)
        )
        .order("asc")
        .paginate(safeOpts);
    }
    return await ctx.db
      .query("paymentRecords")
      .withIndex("by_month_and_referencia", (q) =>
        q.eq("importMonth", month)
      )
      .order("asc")
      .paginate(safeOpts);
  },
});

export const getPaymentsBySource = query({
  args: { source: v.string() },
  handler: async (ctx, { source }) => {
    if (source !== "v1" && source !== "v2" && source !== "payment") {
      return [];
    }
    return await ctx.db
      .query("paymentRecords")
      .withIndex("by_source", (q) => q.eq("logSource", source))
      .collect();
  },
});

export const getPaymentsBySourceAndMonth = query({
  args: { source: v.string(), month: v.string() },
  handler: async (ctx, { source, month }) => {
    if (source !== "v1" && source !== "v2" && source !== "payment") {
      return [];
    }
    return await ctx.db
      .query("paymentRecords")
      .withIndex("by_source_and_month", (q) =>
        q.eq("logSource", source).eq("importMonth", month)
      )
      .collect();
  },
});

export const getMonthSummary = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    const totalPagos = records.length;
    const montoTotal = records.reduce((sum, r) => sum + r.monto, 0);

    const config = await getMovementConfig(ctx);
    const porMovimiento: Record<string, number> = {};
    const porFuente: Record<string, number> = {};

    for (const r of records) {
      const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
      porMovimiento[mov] = (porMovimiento[mov] || 0) + 1;
      porFuente[r.logSource] = (porFuente[r.logSource] || 0) + 1;
    }

    const referenciasUnicas = new Set(records.map((r) => r.referencia)).size;

    return {
      month,
      totalPagos,
      montoTotal,
      referenciasUnicas,
      porMovimiento,
      porFuente,
    };
  },
});

export const searchByReferencia = query({
  args: { referencia: v.string() },
  handler: async (ctx, { referencia }) => {
    return await ctx.db
      .query("paymentRecords")
      .withIndex("by_referencia", (q) => q.eq("referencia", referencia))
      .collect();
  },
});

export const getDayComparison = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const sources = ["v1", "v2", "payment"] as const;
    const result: Record<
      string,
      {
        count: number;
        montoTotal: number;
        porMovimiento: Record<string, number>;
        pagos: Array<{
          referencia: string;
          monto: number;
          timestamp: string;
          fechaTransaccion: string;
          movimiento: string;
          estatus: string;
        }>;
      }
    > = {};

    for (const source of sources) {
      let records;
      try {
        records = await ctx.db
          .query("paymentRecords")
          .withIndex("by_source_and_date", (q) =>
            q.eq("logSource", source).eq("importDate", date)
          )
          .collect();
      } catch {
        records = await ctx.db
          .query("paymentRecords")
          .withIndex("by_source_and_month", (q) =>
            q.eq("logSource", source).eq("importMonth", date.substring(0, 7))
          )
          .collect();
        records = records.filter(
          (r) =>
            (r.importDate && r.importDate === date) ||
            (r.timestamp && r.timestamp.startsWith(date))
        );
      }

      const config = await getMovementConfig(ctx);
      const montoTotal = records.reduce((s, r) => s + r.monto, 0);
      const porMovimiento: Record<string, number> = {};
      for (const r of records) {
        const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
        porMovimiento[mov] = (porMovimiento[mov] || 0) + 1;
      }

      result[source] = {
        count: records.length,
        montoTotal,
        porMovimiento,
        pagos: records.slice(0, 50).map((p) => ({
          referencia: p.referencia,
          monto: p.monto,
          timestamp: p.timestamp,
          fechaTransaccion: p.fechaTransaccion,
          movimiento: p.movimiento,
          estatus: p.estatus,
        })),
      };
    }

    return { date, results: result };
  },
});

export const getUniqueReferences = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    return [...new Set(records.map((r) => r.referencia))];
  },
});

/** KPIs del mes: total pagos, monto, referencias únicas, promedio diario, conteo por fuente */
export const getMonthKPIs = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    const totalPagos = records.length;
    const montoTotal = records.reduce((sum, r) => sum + r.monto, 0);
    const referenciasUnicas = new Set(records.map((r) => r.referencia)).size;
    const diasConDatos = new Set(records.map((r) => r.importDate).filter(Boolean)).size;
    const promedioDiario = diasConDatos > 0 ? totalPagos / diasConDatos : 0;

    const porFuente: Record<string, number> = {};
    for (const r of records) {
      porFuente[r.logSource] = (porFuente[r.logSource] || 0) + 1;
    }

    return {
      month,
      totalPagos,
      montoTotal,
      referenciasUnicas,
      promedioDiario: Math.round(promedioDiario),
      diasConDatos,
      porFuente,
    };
  },
});

/** Desglose diario del mes para gráfica de tendencia */
export const getDailyBreakdown = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    const [year, mon] = month.split("-").map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();

    const byDay: Record<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    > = {};

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      byDay[dateStr] = { count: 0, monto: 0, v1: 0, v2: 0, payment: 0 };
    }

    for (const r of records) {
      const dateStr = r.importDate ?? r.timestamp?.substring(0, 10) ?? "";
      if (!dateStr || !byDay[dateStr]) continue;

      byDay[dateStr].count += 1;
      byDay[dateStr].monto += r.monto;
      if (r.logSource === "v1") byDay[dateStr].v1 += 1;
      else if (r.logSource === "v2") byDay[dateStr].v2 += 1;
      else if (r.logSource === "payment") byDay[dateStr].payment += 1;
    }

    return {
      month,
      days: Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data })),
    };
  },
});

/** Estadísticas por tipo de movimiento con desglose por fuente */
export const getMovementTypeStats = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    const config = await getMovementConfig(ctx);
    const byMovimiento: Record<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    > = {};

    for (const r of records) {
      const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
      if (!byMovimiento[mov]) {
        byMovimiento[mov] = { count: 0, monto: 0, v1: 0, v2: 0, payment: 0 };
      }
      byMovimiento[mov].count += 1;
      byMovimiento[mov].monto += r.monto;
      if (r.logSource === "v1") byMovimiento[mov].v1 += 1;
      else if (r.logSource === "v2") byMovimiento[mov].v2 += 1;
      else if (r.logSource === "payment") byMovimiento[mov].payment += 1;
    }

    return {
      month,
      byMovimiento: Object.entries(byMovimiento)
        .sort(([, a], [, b]) => b.count - a.count)
        .map(([movimiento, data]) => ({ movimiento, ...data })),
    };
  },
});

/** Comparación detallada entre fuentes V1, V2, EVO */
export const getSourceStats = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    const totalPagos = records.length;
    const montoTotal = records.reduce((sum, r) => sum + r.monto, 0);

    const sources = ["v1", "v2", "payment"] as const;
    const stats = sources.map((source) => {
      const filtered = records.filter((r) => r.logSource === source);
      const count = filtered.length;
      const monto = filtered.reduce((s, r) => s + r.monto, 0);
      const pctCount = totalPagos > 0 ? (count / totalPagos) * 100 : 0;
      const pctMonto = montoTotal > 0 ? (monto / montoTotal) * 100 : 0;
      return {
        source,
        count,
        monto,
        pctCount,
        pctMonto,
      };
    });

    return { month, totalPagos, montoTotal, sources: stats };
  },
});

/** Estado de ingestion: qué días tienen datos y cuántos registros */
export const getIngestionStatus = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    const byDate: Record<string, number> = {};
    for (const r of records) {
      const dateStr = r.importDate ?? r.timestamp?.substring(0, 10) ?? "";
      if (dateStr) {
        byDate[dateStr] = (byDate[dateStr] || 0) + 1;
      }
    }

    return {
      month,
      totalRecords: records.length,
      daysWithData: Object.keys(byDate).length,
      byDate: Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
    };
  },
});
