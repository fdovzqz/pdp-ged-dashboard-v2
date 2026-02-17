import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  getMovementConfig,
  normalizeWithConfig,
} from "./movementCodes";
import { timestampToMexicoMonth } from "./lib/mexicoDate";
import { extractStatusAndFuenteFromRawJson } from "./lib/dynamodb";

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

/** Query auxiliar: retorna una página de paymentRecords por mes. */
export const getPaymentRecordsPageByMonth = query({
  args: {
    month: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { month, cursor, numItems = 5000 }) => {
    const result = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => r.referencia),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Página con detalles (importDate, monto, logSource) para diagnóstico. */
export const getPaymentRecordsPageWithDetails = query({
  args: {
    month: v.string(),
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { month, cursor, numItems = 5000 }) => {
    const result = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .order("asc")
      .paginate({ numItems, cursor: cursor ?? null });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        timestamp: r.timestamp,
        importDate: r.importDate,
        importMonth: r.importMonth,
        monto: r.monto,
        logSource: r.logSource,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Verifica duplicados en un solo mes (por debajo del límite de lectura).
 * Útil para verificar mes a mes desde el dashboard o scripts.
 */
export const findDuplicateReferenciasInMonth = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const records = await ctx.db
      .query("paymentRecords")
      .withIndex("by_month", (q) => q.eq("importMonth", month))
      .collect();

    const countByRef = new Map<string, number>();
    for (const rec of records) {
      countByRef.set(rec.referencia, (countByRef.get(rec.referencia) ?? 0) + 1);
    }

    const duplicates: Array<{ referencia: string; count: number }> = [];
    for (const [ref, count] of countByRef) {
      if (count > 1) {
        duplicates.push({ referencia: ref, count });
      }
    }

    duplicates.sort((a, b) => b.count - a.count);

    return {
      month,
      totalRecords: records.length,
      uniqueReferencias: countByRef.size,
      duplicateReferencias: duplicates.length,
      totalDuplicateRecords: duplicates.reduce((s, d) => s + d.count, 0),
      top: duplicates.slice(0, 20),
    };
  },
});

/** Límite por tabla para no exceder 8192 items en el resultado. */
const RECONCILIATION_TAKE = 8000;

/** Valor de status que se considera pago validado en DataMapping. Usado en reconciliación y agregaciones. */
const PAGO_VALIDADO_STATUS = "PAGO VALIDADO";

/** Rango amplio para consultas datamapping sin filtro de fecha. */
const DATAMAPPING_UNIVERSE_START = "2000-01-01T00:00:00.000Z";
const DATAMAPPING_UNIVERSE_END = "2031-01-01T00:00:00.000Z";

/**
 * Reconciliación CloudWatch (paymentRecords) vs DynamoDB (datamappingRecords) por referencia.
 * Solo considera paymentRecords del mes dado y datamappingRecords con status = PAGO VALIDADO.
 */
export const getReconciliationReport = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const [cwRecords, ddbRecords] = await Promise.all([
      ctx.db
        .query("paymentRecords")
        .withIndex("by_month", (q) => q.eq("importMonth", month))
        .take(RECONCILIATION_TAKE),
      ctx.db
        .query("datamappingRecords")
        .withIndex("by_status_updatedAt", (q) =>
          q
            .eq("status", PAGO_VALIDADO_STATUS)
            .gte("updatedAt", DATAMAPPING_UNIVERSE_START)
            .lt("updatedAt", DATAMAPPING_UNIVERSE_END)
        )
        .take(RECONCILIATION_TAKE),
    ]);

    const byRefCw = new Map<string, { monto: number; logSource: string }>();
    for (const r of cwRecords) {
      const existing = byRefCw.get(r.referencia);
      if (!existing || r.logSource === "payment")
        byRefCw.set(r.referencia, { monto: r.monto, logSource: r.logSource });
    }
    const byRefDdb = new Map<string, number>();
    for (const r of ddbRecords) {
      byRefDdb.set(r.referencia, r.monto);
    }

    const onlyInCloudWatch: string[] = [];
    const onlyInDynamoDB: string[] = [];
    const inBothMatch: Array<{ referencia: string; monto: number }> = [];
    const inBothMismatch: Array<{
      referencia: string;
      montoCloudWatch: number;
      montoDynamoDB: number;
    }> = [];

    for (const [ref, { monto }] of byRefCw) {
      if (!byRefDdb.has(ref)) {
        onlyInCloudWatch.push(ref);
      } else {
        const montoDdb = byRefDdb.get(ref)!;
        if (monto === montoDdb) {
          inBothMatch.push({ referencia: ref, monto });
        } else {
          inBothMismatch.push({
            referencia: ref,
            montoCloudWatch: monto,
            montoDynamoDB: montoDdb,
          });
        }
      }
    }
    for (const [ref] of byRefDdb) {
      if (!byRefCw.has(ref)) onlyInDynamoDB.push(ref);
    }

    return {
      month,
      totalCloudWatch: cwRecords.length,
      totalDynamoDB: ddbRecords.length,
      onlyInCloudWatch: onlyInCloudWatch.length,
      onlyInDynamoDB: onlyInDynamoDB.length,
      inBothMatch: inBothMatch.length,
      inBothMismatch: inBothMismatch.length,
      sampleOnlyInCloudWatch: onlyInCloudWatch.slice(0, 50),
      sampleOnlyInDynamoDB: onlyInDynamoDB.slice(0, 50),
      sampleInBothMismatch: inBothMismatch.slice(0, 50),
    };
  },
});

/** Rango enero 2026 en hora México (UTC-6): [1 ene 00:00, 1 feb 00:00) México = [2026-01-01T06:00Z, 2026-02-01T06:00Z). */
const JAN_2026_START = "2026-01-01T06:00:00.000Z";
const JAN_2026_END = "2026-02-01T06:00:00.000Z";

/** Tamaño de página para no exceder 16MB por lectura (datamapping tiene rawJson grande). */
const JAN_2026_DATAMAPPING_PAGE_SIZE = 500;

/** Obtiene el primer día del mes siguiente (YYYY-MM). */
function getNextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return `${month}-02`;
  const next = new Date(y, m, 1); // m is 1-based, Date uses 0-based
  const ny = next.getFullYear();
  const nm = String(next.getMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}-01`;
}

/** Límite de referencias por batch en getFechaTransaccionForReferencias. */
const MAX_REFERENCIAS_FECHA_LOOKUP = 500;

/**
 * Devuelve fechaTransaccion desde paymentRecords por referencia.
 * Si hay varios paymentRecords con la misma referencia, prioriza el que tenga monto coincidente; si no, el primero.
 * Usado por backfill de fechaTransaccion en datamappingRecords.
 */
export const getFechaTransaccionForReferencias = query({
  args: {
    referencias: v.array(
      v.object({ referencia: v.string(), monto: v.number() })
    ),
  },
  handler: async (ctx, { referencias }): Promise<Record<string, string>> => {
    const refs = referencias.slice(0, MAX_REFERENCIAS_FECHA_LOOKUP);
    const out: Record<string, string> = {};
    for (const { referencia, monto } of refs) {
      const records = await ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", referencia))
        .collect();
      if (records.length === 0) continue;
      const exactMatch = records.find((r) => r.monto === monto);
      const chosen = exactMatch ?? records[0];
      out[referencia] = chosen.fechaTransaccion;
    }
    return out;
  },
});

/**
 * Página de datamappingRecords filtrada por mes (updatedAt o fechaTransaccion en rango) y solo status = PAGO VALIDADO.
 * Usado por buildDatamappingAggregates para ETL; los tableros mensual y anual solo usan pagos validados.
 * Registros sin status (carga antigua) no se incluyen hasta que tengan status enriquecido/backfill.
 * useFechaTransaccion: si true, filtra por fechaTransaccion; si false/undefined, por updatedAt (compatibilidad).
 */
export const getDatamappingRecordsByMonthPaginated = query({
  args: {
    month: v.string(),
    paginationOpts: paginationOptsValidator,
    useFechaTransaccion: v.optional(v.boolean()),
  },
  handler: async (ctx, { month, paginationOpts, useFechaTransaccion }) => {
    const start = `${month}-01`;
    const end = getNextMonthStart(month);
    const safeOpts = {
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, 1000),
    };
    if (useFechaTransaccion) {
      const result = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_status_fechaTransaccion", (q) =>
          q
            .eq("status", PAGO_VALIDADO_STATUS)
            .gte("fechaTransaccion", start)
            .lt("fechaTransaccion", end)
        )
        .order("asc")
        .paginate(safeOpts);
      return {
        page: result.page.map((r) => ({
          referencia: r.referencia,
          monto: r.monto,
          updatedAt: r.updatedAt,
          fechaTransaccion: r.fechaTransaccion,
          tipoMovimiento: r.tipoMovimiento,
          fuente: r.fuente,
        })),
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      };
    }
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_status_updatedAt", (q) =>
        q
          .eq("status", PAGO_VALIDADO_STATUS)
          .gte("updatedAt", start)
          .lt("updatedAt", end)
      )
      .order("asc")
      .paginate(safeOpts);
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
        fechaTransaccion: r.fechaTransaccion,
        tipoMovimiento: r.tipoMovimiento,
        fuente: r.fuente,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Tamaño de página CloudWatch (registros más pequeños). */
const JAN_2026_CLOUDWATCH_PAGE_SIZE = 5000;

const KNOWN_FUENTE_VALUES = ["EVO", "DEC", "CODI", "MIT"] as const;

/**
 * Valores distintos de `fuente` en datamappingRecords con conteo.
 * Útil para conocer los códigos disponibles (EVO, DEC, etc.).
 * Si se pasa `month` (ej. "2026-01"), filtra por ese mes; si no, toma hasta 10k.
 */
export const getDatamappingFuenteValues = query({
  args: {
    month: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { month, limit = 10000 }) => {
    const start = month ? `${month}-01` : undefined;
    const end = month ? getNextMonthStart(month) : undefined;
    const q = ctx.db.query("datamappingRecords");
    // Con enero: requiere action getDatamappingFuenteCountsByMonth (demasiados datos para una sola query).
    const records = start && end
      ? await q
          .withIndex("by_updatedAt", (idx) =>
            idx.gte("updatedAt", start).lt("updatedAt", end)
          )
          .collect()
      : await q.take(Math.min(limit, 10000));
    const byFuente = new Map<string, number>();
    for (const r of records) {
      const f = (r.fuente ?? "").trim() || "(vacío)";
      byFuente.set(f, (byFuente.get(f) ?? 0) + 1);
    }
    return Array.from(byFuente.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  },
});

/**
 * Devuelve valores de `fuente` que NO son los conocidos (EVO, DEC, CODI, MIT).
 * Útil para detectar si hay otros códigos en los datos (ej. SPEI, vacío, o nuevos).
 * Si se pasa `month` (ej. "2026-01"), filtra por ese mes; si no, toma hasta 10k registros.
 */
export const getDatamappingOtherFuenteValues = query({
  args: {
    month: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { month, limit = 5000 }): Promise<{ value: string; count: number }[]> => {
    const start = month ? `${month}-01` : undefined;
    const end = month ? getNextMonthStart(month) : undefined;
    const q = ctx.db.query("datamappingRecords");
    const maxItems = Math.min(limit, 5000);
    const records =
      start && end
        ? await q
            .withIndex("by_updatedAt", (idx) =>
              idx.gte("updatedAt", start).lt("updatedAt", end)
            )
            .take(maxItems)
        : await q.take(maxItems);
    const byFuente = new Map<string, number>();
    for (const r of records) {
      const raw = (r.fuente ?? "").trim();
      const value = raw || "(vacío)";
      const normalized = raw.toUpperCase();
      if (!KNOWN_FUENTE_VALUES.includes(normalized as (typeof KNOWN_FUENTE_VALUES)[number])) {
        byFuente.set(value, (byFuente.get(value) ?? 0) + 1);
      }
    }
    return Array.from(byFuente.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  },
});

/**
 * Página de datamappingRecords (tabla Convex, origen DynamoDB) para enero 2026.
 * Usado por la action de reconciliación; solo lectura en Convex, sin AWS.
 */
export const getJanuary2026DatamappingPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, numItems = JAN_2026_DATAMAPPING_PAGE_SIZE }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", JAN_2026_START).lt("updatedAt", JAN_2026_END)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Busca registros datamapping por RFC (índice by_rfc) en el rango desde enero hasta la fecha.
 * Requiere ETL de enriquecimiento previo. Filtra por updatedAt.
 */
export const getDatamappingRecordsByRfcs = query({
  args: {
    rfcs: v.array(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  handler: async (ctx, { rfcs, fromDate, toDate }) => {
    const rfcsNormalized = rfcs
      .map((r) => r.trim().toUpperCase())
      .filter((r) => r.length > 0);
    const updatedAtFrom = fromDate
      ? (fromDate.includes("T") ? fromDate : `${fromDate}T00:00:00.000Z`)
      : "2026-01-01T00:00:00.000Z";
    const updatedAtTo = toDate
      ? (toDate.includes("T")
          ? toDate
          : (() => {
              const [y, m, d] = toDate.split("-").map(Number);
              const next = new Date(Date.UTC(y, m - 1, d + 1));
              return next.toISOString().replace(/\.\d{3}Z$/, ".000Z");
            })())
      : "2030-12-31T23:59:59.999Z";

    const results: Array<{
      rfc: string;
      referencia: string;
      monto: number;
      updatedAt: string;
      tipoMovimiento?: string;
      fuente?: string;
      status?: string;
      loteId?: string;
      tramiteId?: string;
      reciboPagoUrl?: string;
      endMonth?: string;
      declarationType?: string;
    }> = [];
    for (const rfc of rfcsNormalized) {
      const records = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_rfc", (q) => q.eq("rfc", rfc))
        .collect();
      for (const r of records) {
        const u = r.updatedAt ?? "";
        if (u >= updatedAtFrom && u < updatedAtTo) {
          let fuente = r.fuente;
          let status = r.status;
          let loteId = r.loteId;
          let reciboPagoUrl: string | undefined;
          let endMonth: string | undefined;
          let declarationType: string | undefined;
          if (r.rawJson) {
            const fromRaw = extractStatusAndFuenteFromRawJson(r.rawJson);
            if (!status && fromRaw.status) status = fromRaw.status;
            if (!fuente && fromRaw.fuente) fuente = fromRaw.fuente;
            if (!loteId && fromRaw.loteId) loteId = fromRaw.loteId;
            reciboPagoUrl = fromRaw.reciboPagoUrl;
            endMonth = fromRaw.endMonth;
            declarationType = fromRaw.declarationType;
          }
          results.push({
            rfc,
            referencia: r.referencia,
            monto: r.monto,
            updatedAt: r.updatedAt,
            tipoMovimiento: r.tipoMovimiento,
            fuente: fuente ?? r.fuente,
            status: status ?? r.status,
            loteId: loteId ?? undefined,
            tramiteId: r.tramiteId,
            reciboPagoUrl: reciboPagoUrl ?? undefined,
            endMonth: endMonth ?? undefined,
            declarationType: declarationType ?? undefined,
          });
        }
      }
    }
    return results;
  },
});

/** Último resultado guardado. reciboPagoUrl, endMonth y declarationType se obtienen siempre de rawJson (lookup por referencia). */
export const getLatestRfcInvestigationResults = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("rfcInvestigationResults")
      .withIndex("by_runAt")
      .order("desc")
      .first();
    if (!doc || !doc.matches.length) return doc ?? null;
    const matchesWithRawJson = await Promise.all(
      doc.matches.map(async (m) => {
        const record = await ctx.db
          .query("datamappingRecords")
          .withIndex("by_referencia", (q) => q.eq("referencia", m.referencia))
          .first();
        if (!record?.rawJson) return m;
        const fromRaw = extractStatusAndFuenteFromRawJson(record.rawJson);
        return {
          ...m,
          reciboPagoUrl: fromRaw.reciboPagoUrl ?? m.reciboPagoUrl,
          endMonth: fromRaw.endMonth ?? (m as { endMonth?: string }).endMonth,
          declarationType:
            fromRaw.declarationType ?? (m as { declarationType?: string }).declarationType,
        };
      })
    );
    return {
      ...doc,
      matches: matchesWithRawJson,
    };
  },
});

/**
 * Página de datamappingRecords con rawJson por tipoMovimiento y rango de updatedAt.
 * @deprecated Usar getDatamappingPageWithRawJsonNeedingEnrichment para enriquecimiento (por enrichmentExtracted).
 */
export const getDatamappingPageWithRawJsonByTipoMovimientoAndDateRange = query({
  args: {
    tipoMovimiento: v.string(),
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { tipoMovimiento, updatedAtFrom, updatedAtTo, cursor, numItems = 150 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_tipoMovimiento_updatedAt", (q) =>
        q.eq("tipoMovimiento", tipoMovimiento).gte("updatedAt", updatedAtFrom).lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        _id: r._id,
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
        tipoMovimiento: r.tipoMovimiento,
        fuente: r.fuente,
        rawJson: r.rawJson,
        rfc: r.rfc,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Página de registros que faltan por enriquecer (enrichmentExtracted === false), por rango updatedAt.
 * No filtra por tipo de movimiento: procesa todos. Extrae RFC + placa, evoId, etc. cuando existan.
 */
export const getDatamappingPageWithRawJsonNeedingEnrichment = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 50 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_enrichmentExtracted_updatedAt", (q) =>
        q
          .eq("enrichmentExtracted", false)
          .gte("updatedAt", updatedAtFrom)
          .lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        _id: r._id,
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
        tipoMovimiento: r.tipoMovimiento,
        fuente: r.fuente,
        rawJson: r.rawJson,
        rfc: r.rfc,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Solo _id de registros que faltan por enriquecer (enrichmentExtracted === false). Para preflight sin rawJson.
 */
export const getDatamappingIdsNeedingEnrichment = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 2000 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_enrichmentExtracted_updatedAt", (q) =>
        q
          .eq("enrichmentExtracted", false)
          .gte("updatedAt", updatedAtFrom)
          .lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({ _id: r._id })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Página de datamappingRecords con rawJson por rango de updatedAt.
 * Usado por searchDatamappingByRfcs (fallback) y por acciones que escanean por fecha.
 */
export const getDatamappingPageWithRawJsonByDateRange = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 100 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) => q.gte("updatedAt", updatedAtFrom).lt("updatedAt", updatedAtTo))
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        _id: r._id,
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
        tipoMovimiento: r.tipoMovimiento,
        fuente: r.fuente,
        rawJson: r.rawJson,
        rfc: r.rfc,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Página de datamappingRecords por rango de updatedAt, solo status = PAGO VALIDADO.
 * Usado por la action de reconciliación con scope mes, periodo o universo.
 */
export const getDatamappingPageByDateRange = query({
  args: {
    updatedAtFrom: v.optional(v.string()),
    updatedAtTo: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = JAN_2026_DATAMAPPING_PAGE_SIZE }) => {
    const from = updatedAtFrom ?? DATAMAPPING_UNIVERSE_START;
    const to = updatedAtTo ?? DATAMAPPING_UNIVERSE_END;
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_status_updatedAt", (q) =>
        q.eq("status", PAGO_VALIDADO_STATUS).gte("updatedAt", from).lt("updatedAt", to)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Página de datamappingRecords solo _id. Para backfill de enrichmentExtracted (marcar todos con false).
 */
export const getDatamappingPageIdForBackfill = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, numItems = 400 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", DATAMAPPING_UNIVERSE_START).lt("updatedAt", DATAMAPPING_UNIVERSE_END)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({ _id: r._id })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Página de datamappingRecords solo _id en un rango updatedAt. Para backfill por mes (Inngest en paralelo).
 */
export const getDatamappingPageIdForBackfillByRange = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 400 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", updatedAtFrom).lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({ _id: r._id })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Página de datamappingRecords con _id, referencia, monto, updatedAt en un rango.
 * Para backfill de fechaTransaccion: lookup en paymentRecords por referencia, fallback a updatedAt.
 */
export const getDatamappingPageForFechaTransaccionBackfill = query({
  args: {
    updatedAtFrom: v.string(),
    updatedAtTo: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { updatedAtFrom, updatedAtTo, cursor, numItems = 200 }) => {
    const result = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", updatedAtFrom).lt("updatedAt", updatedAtTo)
      )
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page.map((r) => ({
        _id: r._id,
        referencia: r.referencia,
        monto: r.monto,
        updatedAt: r.updatedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Tamaño de muestra para detectar enrichmentExtracted undefined (backfill). */
const DATAMAPPING_ENRICHMENT_UNDEFINED_SAMPLE = 300;

/** Muestra de registros para detectar si alguno tiene enrichmentExtracted undefined (requiere backfill). */
export const getDatamappingHasEnrichmentExtractedUndefined = query({
  args: {},
  handler: async (ctx): Promise<{ hasUndefined: boolean }> => {
    const sample = await ctx.db
      .query("datamappingRecords")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", DATAMAPPING_UNIVERSE_START).lt("updatedAt", DATAMAPPING_UNIVERSE_END)
      )
      .order("asc")
      .take(DATAMAPPING_ENRICHMENT_UNDEFINED_SAMPLE);
    const hasUndefined = sample.some((r) => r.enrichmentExtracted === undefined);
    return { hasUndefined };
  },
});

const RFC_ENRICHMENT_RUNS_LIMIT = 30;

/** Lista las últimas ejecuciones de enriquecimiento RFC (para tabla de estado persistente). */
export const getRfcEnrichmentRuns = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("rfcEnrichmentRuns")
      .withIndex("by_startedAt", (q) => q.lte("startedAt", Date.now()))
      .order("desc")
      .take(RFC_ENRICHMENT_RUNS_LIMIT);
  },
});

/**
 * Reconciliación Enero 2026 (versión limitada en una sola query).
 * Para ~70k registros usar la action getJanuary2026Reconciliation en actions.ts.
 */
export const getJanuary2026Reconciliation = query({
  args: {},
  handler: async (ctx) => {
    const month = "2026-01";
    const [cwRecords, ddbRecords] = await Promise.all([
      ctx.db
        .query("paymentRecords")
        .withIndex("by_month", (q) => q.eq("importMonth", month))
        .take(RECONCILIATION_TAKE),
      ctx.db
        .query("datamappingRecords")
        .withIndex("by_updatedAt", (q) =>
          q.gte("updatedAt", JAN_2026_START).lt("updatedAt", JAN_2026_END)
        )
        .take(2500),
    ]);

    const byRefCw = new Map<
      string,
      { monto: number; logSource: "payment" | "v1" | "v2" }
    >();
    const order: Record<string, number> = { payment: 0, v2: 1, v1: 2 };
    for (const r of cwRecords) {
      const existing = byRefCw.get(r.referencia);
      if (
        !existing ||
        order[r.logSource] < order[existing.logSource as keyof typeof order]
      ) {
        byRefCw.set(r.referencia, { monto: r.monto, logSource: r.logSource });
      }
    }
    const bySource = { payment: 0, v1: 0, v2: 0 };
    for (const r of cwRecords) bySource[r.logSource]++;
    const refsBySource = { payment: 0, v1: 0, v2: 0 };
    for (const { logSource } of byRefCw.values()) refsBySource[logSource]++;

    const byRefDdb = new Map<string, number>();
    for (const r of ddbRecords) byRefDdb.set(r.referencia, r.monto);

    const onlyInCloudWatch: string[] = [];
    const onlyInDynamoDB: string[] = [];
    const inBothMatch: Array<{ referencia: string; monto: number }> = [];
    const inBothMismatch: Array<{
      referencia: string;
      montoCloudWatch: number;
      montoDynamoDB: number;
      logSource: string;
    }> = [];

    for (const [ref, { monto, logSource }] of byRefCw) {
      if (!byRefDdb.has(ref)) {
        onlyInCloudWatch.push(ref);
      } else {
        const montoDdb = byRefDdb.get(ref)!;
        if (monto === montoDdb) {
          inBothMatch.push({ referencia: ref, monto });
        } else {
          inBothMismatch.push({
            referencia: ref,
            montoCloudWatch: monto,
            montoDynamoDB: montoDdb,
            logSource,
          });
        }
      }
    }
    for (const [ref] of byRefDdb) {
      if (!byRefCw.has(ref)) onlyInDynamoDB.push(ref);
    }
    const onlyCwBySource = { payment: 0, v1: 0, v2: 0 };
    for (const ref of onlyInCloudWatch) {
      const s = byRefCw.get(ref)?.logSource;
      if (s) onlyCwBySource[s]++;
    }

    return {
      month,
      cloudWatch: {
        totalRecords: cwRecords.length,
        uniqueReferencias: byRefCw.size,
        bySourceRecords: bySource,
        bySourceUniqueRefs: refsBySource,
      },
      datamapping: {
        totalRecords: ddbRecords.length,
        uniqueReferencias: byRefDdb.size,
        filter: { updatedAtFrom: JAN_2026_START, updatedAtTo: JAN_2026_END },
        truncated: ddbRecords.length === 2500,
      },
      differences: {
        onlyInCloudWatch: onlyInCloudWatch.length,
        onlyInDynamoDB: onlyInDynamoDB.length,
        inBothMatch: inBothMatch.length,
        inBothMismatch: inBothMismatch.length,
        onlyInCloudWatchBySource: onlyCwBySource,
      },
      samples: {
        onlyInCloudWatch: onlyInCloudWatch.slice(0, 100),
        onlyInDynamoDB: onlyInDynamoDB.slice(0, 100),
        inBothMismatch: inBothMismatch.slice(0, 50),
        inBothMatch: inBothMatch.slice(0, 30),
      },
    };
  },
});

// --- Reconciliación: resumen y errores persistidos ---

/** Resumen de la última reconciliación (scope: universo, un mes o periodo). Una sola fila; se sobrescribe al re-ejecutar. */
export const getReconciliationSummaryJanuary2026 = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("reconciliationSummary").first();
    return doc;
  },
});

/** Para enriquecer filas "Solo en Datamapping": devuelve mes (YYYY-MM) en hora México de paymentRecords por referencia (máx 300 refs). */
const MAX_REFERENCIAS_LOOKUP = 300;

export const getPaymentRecordsMonthsForReferencias = query({
  args: { referencias: v.optional(v.array(v.string())) },
  handler: async (ctx, { referencias }) => {
    const list = referencias ?? [];
    const refs = list.slice(0, MAX_REFERENCIAS_LOOKUP);
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const rec = await ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (!rec) continue;
      const month =
        rec.timestamp && /^\d{4}/.test(rec.timestamp)
          ? timestampToMexicoMonth(rec.timestamp)
          : (rec.importMonth ?? "").substring(0, 7);
      if (month) out[ref] = month;
    }
    return out;
  },
});

/** Para enriquecer filas "Solo en CloudWatch": devuelve mes (YYYY-MM) de datamappingRecords por referencia (máx 300 refs). */
export const getDatamappingMonthsForReferencias = query({
  args: { referencias: v.optional(v.array(v.string())) },
  handler: async (ctx, { referencias }) => {
    const list = referencias ?? [];
    const refs = list.slice(0, MAX_REFERENCIAS_LOOKUP);
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const rec = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (rec?.updatedAt) out[ref] = timestampToMexicoMonth(rec.updatedAt);
    }
    return out;
  },
});

/** Devuelve updatedAt completo de datamappingRecords por referencia (máx 300 refs). Usado en la action para reclasificar onlyCw → monthMismatch. */
export const getDatamappingUpdatedAtForReferencias = query({
  args: { referencias: v.optional(v.array(v.string())) },
  handler: async (ctx, { referencias }) => {
    const list = referencias ?? [];
    const refs = list.slice(0, MAX_REFERENCIAS_LOOKUP);
    const out: Record<string, string> = {};
    for (const ref of refs) {
      const rec = await ctx.db
        .query("datamappingRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .first();
      if (rec?.updatedAt) out[ref] = rec.updatedAt;
    }
    return out;
  },
});

/** Referencias solo en CloudWatch con fuente payment (PAGO VALIDADO). Para listar referencia y status. */
export const getReconciliationErrorsOnlyCwWithPayment = query({
  args: {},
  handler: async (ctx) => {
    const allOnlyCw = await ctx.db
      .query("reconciliationErrors")
      .withIndex("by_kind", (q) => q.eq("kind", "onlyCw"))
      .take(500);
    return allOnlyCw
      .filter((r) => r.logSource === "payment")
      .map((r) => ({
        referencia: r.referencia,
        status: "PAGO VALIDADO" as const,
        monto: r.monto,
      }));
  },
});

/** Página de errores por tipo (onlyCw | onlyDdb | mismatch | monthMismatch) para tabla y CSV. */
export const getReconciliationErrorsPage = query({
  args: {
    kind: v.union(
      v.literal("onlyCw"),
      v.literal("onlyDdb"),
      v.literal("mismatch"),
      v.literal("monthMismatch")
    ),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { kind, cursor, numItems = 500 }) => {
    const result = await ctx.db
      .query("reconciliationErrors")
      .withIndex("by_kind", (q) => q.eq("kind", kind))
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Diagnóstico: por qué una referencia aparece como "solo en CloudWatch" u otra categoría.
 * Busca en paymentRecords y en datamappingRecords (sin filtrar por updatedAt) y comprueba
 * si entra en el rango de la reconciliación (updatedAt en enero 2026).
 * Si referencia no se envía o está vacía, devuelve conclusion indicándolo (para poder usar useQuery con skip).
 */
export const investigateReferenciaReconciliation = query({
  args: { referencia: v.optional(v.string()) },
  handler: async (ctx, { referencia }) => {
    if (referencia == null || referencia.trim() === "") {
      return {
        referencia: "",
        paymentRecords: [],
        datamappingRecords: [],
        inJanuary2026Range: false,
        conclusion: "Ingresa una referencia y pulsa Investigar.",
        note: null,
      };
    }
    const ref = referencia.trim();
    const [cwMatches, ddbMatches] = await Promise.all([
      ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .take(50),
      ctx.db
        .query("datamappingRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .take(50),
    ]);

    const janStart = "2026-01-01T06:00:00.000Z";
    const janEnd = "2026-02-01T06:00:00.000Z";
    const datamappingWithRange = ddbMatches.map((r) => ({
      referencia: r.referencia,
      monto: r.monto,
      updatedAt: r.updatedAt,
      inJanuary2026: r.updatedAt >= janStart && r.updatedAt < janEnd,
    }));

    const inCw = cwMatches.length > 0;
    const inDdbAny = ddbMatches.length > 0;
    const inDdbJanuary = datamappingWithRange.some((r) => r.inJanuary2026);
    /** La reconciliación solo usa paymentRecords con importMonth = 2026-01. */
    const cwInJanuary2026 = cwMatches.some((r) => r.importMonth === "2026-01");

    let conclusion: string;
    if (!inCw && !inDdbAny) {
      conclusion = "No encontrada en paymentRecords ni en datamappingRecords.";
    } else if (inCw && !inDdbAny) {
      conclusion =
        "Está en CloudWatch (paymentRecords) pero no hay ningún registro en datamappingRecords con esta referencia exacta. Posibles causas: (1) referencia en DynamoDB con otro formato (ej. número que perdió precisión > 2^53); (2) aún no ingerido.";
    } else if (!inCw && inDdbAny) {
      conclusion =
        "Está en datamappingRecords pero no en paymentRecords.";
    } else if (cwInJanuary2026 && inDdbJanuary) {
      conclusion =
        "Está en ambas tablas con importMonth 2026-01 (paymentRecords) y updatedAt en enero 2026 (datamapping). Debería aparecer como match o mismatch; si no, revisar duplicados o prioridad.";
    } else if (!cwInJanuary2026 && inDdbJanuary) {
      const months = [...new Set(cwMatches.map((r) => r.importMonth))].join(", ");
      conclusion =
        `Está en ambas tablas, pero en paymentRecords el importMonth no es 2026-01 (tiene: ${months}). La reconciliación solo considera paymentRecords de enero 2026; en datamapping sí tiene updatedAt en enero 2026. Por eso aparece como "Solo en Datamapping".`;
    } else if (cwInJanuary2026 && !inDdbJanuary) {
      conclusion =
        "Está en paymentRecords con importMonth 2026-01, pero en datamappingRecords el updatedAt está fuera de enero 2026. La reconciliación solo considera datamapping con updatedAt en ese rango; por eso aparece como 'Solo en CloudWatch'.";
    } else {
      conclusion =
        "Está en ambas tablas; ni paymentRecords tiene importMonth 2026-01 ni datamapping tiene updatedAt en enero 2026. Para esta reconciliación (ene 2026) no entra en ninguno de los dos lados.";
    }

    return {
      referencia: ref,
      paymentRecords: cwMatches.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        logSource: r.logSource,
        importMonth: r.importMonth,
        importDate: r.importDate,
      })),
      datamappingRecords: datamappingWithRange,
      inJanuary2026Range: inDdbJanuary,
      conclusion,
      note: "Referencias numéricas > 2^53 pueden truncarse si DynamoDB las guarda como número (precisión JS).",
    };
  },
});

/** Devuelve la última updatedAt procesada en extracción incremental (null si nunca se ha corrido). */
export const getDatamappingWatermark = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("processingControl")
      .withIndex("by_key", (q) => q.eq("key", "datamapping_watermark"))
      .first();
    return { lastUpdatedAt: doc?.lastProcessedTimestamp ?? null };
  },
});
