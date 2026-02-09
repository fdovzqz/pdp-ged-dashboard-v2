"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

/** Límite Convex: 600 segundos por acción. */
const ACTION_TIME_LIMIT_MS = 550_000;
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import { parseV1V2, parsePayment } from "./lib/parsers";
import { normalizeWithConfig } from "./movementCodes";

const LOG_GROUPS = {
  v1: process.env.CLOUDWATCH_LOG_GROUP_V1!,
  v2: process.env.CLOUDWATCH_LOG_GROUP_V2!,
  payment: process.env.CLOUDWATCH_LOG_GROUP_PAYMENT!,
} as const;

const client = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

async function fetchCloudWatch(
  version: "v1" | "v2" | "payment",
  startTimeSec: number,
  endTimeSec: number
): Promise<Array<Record<string, string>>> {
  const logGroup = LOG_GROUPS[version];
  const query =
    version === "payment"
      ? `fields @timestamp, @message, @logStream, @log
| filter details.parameters like /./
| parse details.parameters '"status":"*"' as status
| parse details.parameters '"tramite":"*"' as tramite
| parse details.parameters '"referencia":"*"' as referencia
| parse details.parameters '"total_pagar":"*"' as monto
| parse details.parameters '"movimiento":"*"' as movimiento
| parse details.parameters '"tipo":"*"' as tipo
| filter status like /PAGO VALIDADO/
| sort @timestamp desc
| limit 10000`
      : `fields @timestamp, @message
| filter @message like /Preparar Datos/ and @message like /TaskStateEntered/
| sort @timestamp desc
| limit 10000`;

  const startRes = await client.send(
    new StartQueryCommand({
      logGroupName: logGroup,
      startTime: startTimeSec,
      endTime: endTimeSec,
      queryString: query,
    })
  );
  if (!startRes.queryId) throw new Error("No queryId");

  let status: QueryStatus | undefined = QueryStatus.Running;
  let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
  let attempts = 0;

  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= 90) throw new Error("Query timeout (90s)");
    await new Promise((r) => setTimeout(r, 1000));
    const getRes = await client.send(
      new GetQueryResultsCommand({ queryId: startRes.queryId })
    );
    status = getRes.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      rawResults = getRes.results || [];
      break;
    }
  }

  return rawResults.map((row) => {
    const result: Record<string, string> = {};
    for (const f of row) {
      if (f.field && f.value) result[f.field] = f.value;
    }
    return result;
  });
}

export const fetchAndIngestForDate = action({
  args: {
    date: v.string(),
  },
  handler: async (ctx, { date }) => {
    // Borrar datos previos por importDate (en lotes, límite 4096 lecturas/mutación)
    let deleteByDateTotal = 0;
    while (true) {
      const res = (await ctx.runMutation(api.mutations.deletePaymentsByDate, {
        date,
      })) as { deleted: number };
      deleteByDateTotal += res.deleted;
      if (res.deleted === 0) break;
    }

    // Hora México (UTC-6): día local 00:00-23:59:59
    // 00:00 México = 06:00 UTC | 23:59:59 México = 05:59:59.999 UTC día sig
    const [y, mo, day] = date.split("-").map(Number);
    const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
    const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
    const startTimeSec = Math.floor(startUtc.getTime() / 1000);
    const endTimeSec = Math.floor(endUtc.getTime() / 1000);

    type Rec = {
      referencia: string;
      monto: number;
      timestamp: string;
      fechaTransaccion: string;
      logSource: "v1" | "v2" | "payment";
      movimiento: string;
      estatus: string;
      tramiteId?: number;
      importMonth: string;
      importDate: string;
    };
    const byRef = new Map<string, { logSource: string; rec: Rec }>();
    // Prioridad: payment > v2 > v1 (menor número = mayor prioridad)
    const order = { payment: 0, v2: 1, v1: 2 };

    // Fetch las 3 fuentes en paralelo para respetar límite Convex de 600s por acción
    const [rowsV1, rowsV2, rowsPayment] = await Promise.all([
      fetchCloudWatch("v1", startTimeSec, endTimeSec).catch((e) => {
        console.error("[v1] Error:", e);
        return [] as Array<Record<string, string>>;
      }),
      fetchCloudWatch("v2", startTimeSec, endTimeSec).catch((e) => {
        console.error("[v2] Error:", e);
        return [] as Array<Record<string, string>>;
      }),
      fetchCloudWatch("payment", startTimeSec, endTimeSec).catch((e) => {
        console.error("[payment] Error:", e);
        return [] as Array<Record<string, string>>;
      }),
    ]);

    for (const [version, rows] of [
      ["v1", rowsV1],
      ["v2", rowsV2],
      ["payment", rowsPayment],
    ] as const) {
      const parsed =
        version === "payment"
          ? parsePayment(rows)
          : parseV1V2(rows, version);

      for (const p of parsed) {
        const existing = byRef.get(p.referencia);
        if (
          !existing ||
          order[version] < order[existing.logSource as keyof typeof order]
        ) {
          byRef.set(p.referencia, {
            logSource: version,
            rec: {
              referencia: p.referencia,
              monto: p.monto,
              timestamp: p.timestamp,
              fechaTransaccion: p.fechaTransaccion,
              logSource: p.logSource,
              movimiento: p.movimiento,
              estatus: p.estatus,
              tramiteId: p.tramiteId,
              importMonth: p.importMonth,
              importDate: p.importDate,
            },
          });
        }
      }
    }

    const records = Array.from(byRef.values()).map((x) => x.rec);
    const referencias = records.map((r) => r.referencia);

    // Borrar en lotes: límite 4096 lecturas/mutación (1 read por referencia)
    const DELETE_BATCH = 500;
    let deleteByRefTotal = 0;
    for (let i = 0; i < referencias.length; i += DELETE_BATCH) {
      const batch = referencias.slice(i, i + DELETE_BATCH);
      const res = (await ctx.runMutation(
        api.mutations.deletePaymentsByReferencias,
        { referencias: batch }
      )) as { deleted: number };
      deleteByRefTotal += res.deleted;
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    const BATCH = 100;

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const result = (await ctx.runMutation(api.mutations.ingestPaymentBatch, {
        records: batch,
      })) as { inserted: number; skipped: number };
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    }

    const month = date.substring(0, 7);
    const config = (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
      descriptions: {},
      aliases: {},
    };
    const byMov = new Map<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    >();
    let v1 = 0,
      v2 = 0,
      payment = 0;
    let v1Monto = 0,
      v2Monto = 0,
      paymentMonto = 0;
    for (const r of records) {
      if (r.logSource === "v1") {
        v1++;
        v1Monto += r.monto;
      } else if (r.logSource === "v2") {
        v2++;
        v2Monto += r.monto;
      } else {
        payment++;
        paymentMonto += r.monto;
      }
      const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
      const cur = byMov.get(mov) ?? {
        count: 0,
        monto: 0,
        v1: 0,
        v2: 0,
        payment: 0,
      };
      cur.count++;
      cur.monto += r.monto;
      if (r.logSource === "v1") cur.v1++;
      else if (r.logSource === "v2") cur.v2++;
      else cur.payment++;
      byMov.set(mov, cur);
    }
    const dayEntry = {
      date,
      count: records.length,
      monto: records.reduce((s, r) => s + r.monto, 0),
      v1,
      v2,
      payment,
      v1Monto,
      v2Monto,
      paymentMonto,
      byMovimiento: Array.from(byMov.entries()).map(([movimiento, d]) => ({
        movimiento,
        ...d,
      })),
      refs: [], // Omitir refs para evitar payload > 1 MiB (límite Convex)
    };
    await ctx.runMutation(api.mutations.updateMonthStatsFromDay, {
      month,
      dayEntry,
    });

    return {
      date,
      deleted: deleteByDateTotal + deleteByRefTotal,
      totalRecords: records.length,
      inserted: totalInserted,
      skipped: totalSkipped,
    };
  },
});

/** Regenera monthStats desde paymentRecords. Útil cuando ya hay datos pero monthStats está vacío. */
export const recreateMonthStatsFromPaymentRecords = action({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const startTime = Date.now();
    const PAGE_SIZE = 1000;
    let cursor: string | null = null;

    const referenciasSet = new Set<string>();
    const diasSet = new Set<string>();
    const porFuente: Record<string, number> = { v1: 0, v2: 0, payment: 0 };
    const montoPorFuente: Record<string, number> = { v1: 0, v2: 0, payment: 0 };
    const byDay = new Map<
      string,
      {
        count: number;
        monto: number;
        v1: number;
        v2: number;
        payment: number;
        v1Monto: number;
        v2Monto: number;
        paymentMonto: number;
        byMovimiento: Map<
          string,
          { count: number; monto: number; v1: number; v2: number; payment: number }
        >;
        refs: string[];
      }
    >();
    const config = (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
      descriptions: {},
      aliases: {},
    };
    const byMovimiento = new Map<
      string,
      { count: number; monto: number; v1: number; v2: number; payment: number }
    >();

    const [year, mon] = month.split("-").map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      byDay.set(dateStr, {
        count: 0,
        monto: 0,
        v1: 0,
        v2: 0,
        payment: 0,
        v1Monto: 0,
        v2Monto: 0,
        paymentMonto: 0,
        byMovimiento: new Map(),
        refs: [],
      });
    }

    type Rec = {
      referencia: string;
      monto: number;
      timestamp: string;
      importDate?: string;
      logSource: "v1" | "v2" | "payment";
      movimiento: string;
    };

    while (true) {
      if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
        throw new Error(
          "Límite de tiempo alcanzado (550s). Mes con demasiados registros."
        );
      }

      const result = (await ctx.runQuery(
        api.queries.getPaymentsByMonthPaginated,
        {
          month,
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        }
      )) as {
        page: Rec[];
        isDone: boolean;
        continueCursor: string | null;
      };

      for (const r of result.page) {
        referenciasSet.add(r.referencia);
        const dateStr = r.importDate ?? r.timestamp?.substring(0, 10) ?? "";
        if (dateStr) diasSet.add(dateStr);

        porFuente[r.logSource] = (porFuente[r.logSource] || 0) + 1;
        montoPorFuente[r.logSource] =
          (montoPorFuente[r.logSource] || 0) + r.monto;

        const dayData = byDay.get(dateStr);
        if (dayData) {
          dayData.count += 1;
          dayData.monto += r.monto;
          dayData.refs.push(r.referencia);
          if (r.logSource === "v1") {
            dayData.v1 += 1;
            dayData.v1Monto += r.monto;
          } else if (r.logSource === "v2") {
            dayData.v2 += 1;
            dayData.v2Monto += r.monto;
          } else {
            dayData.payment += 1;
            dayData.paymentMonto += r.monto;
          }

          const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
          const movCur = dayData.byMovimiento.get(mov) ?? {
            count: 0,
            monto: 0,
            v1: 0,
            v2: 0,
            payment: 0,
          };
          movCur.count += 1;
          movCur.monto += r.monto;
          if (r.logSource === "v1") movCur.v1 += 1;
          else if (r.logSource === "v2") movCur.v2 += 1;
          else movCur.payment += 1;
          dayData.byMovimiento.set(mov, movCur);
        }

        const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
        const movGlobal = byMovimiento.get(mov) ?? {
          count: 0,
          monto: 0,
          v1: 0,
          v2: 0,
          payment: 0,
        };
        movGlobal.count += 1;
        movGlobal.monto += r.monto;
        if (r.logSource === "v1") movGlobal.v1 += 1;
        else if (r.logSource === "v2") movGlobal.v2 += 1;
        else movGlobal.payment += 1;
        byMovimiento.set(mov, movGlobal);
      }

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    const totalPagos = Array.from(byDay.values()).reduce((s, d) => s + d.count, 0);
    const montoTotal = Array.from(byDay.values()).reduce((s, d) => s + d.monto, 0);
    const diasConDatos = Array.from(byDay.values()).filter((d) => d.count > 0)
      .length;
    const promedioDiario =
      diasConDatos > 0 ? Math.round(totalPagos / diasConDatos) : 0;

    const dayEntries = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        count: d.count,
        monto: d.monto,
        v1: d.v1,
        v2: d.v2,
        payment: d.payment,
        v1Monto: d.v1Monto,
        v2Monto: d.v2Monto,
        paymentMonto: d.paymentMonto,
        byMovimiento: Array.from(d.byMovimiento.entries()).map(
          ([movimiento, data]) => ({ movimiento, ...data })
        ),
        refs: [], // Omitir refs para evitar payload > 1 MiB; referenciasUnicas ya en kpis
      }));

    const dailyBreakdown = dayEntries.map((e) => ({
      date: e.date,
      count: e.count,
      monto: e.monto,
      v1: e.v1,
      v2: e.v2,
      payment: e.payment,
      v1Monto: e.v1Monto,
      v2Monto: e.v2Monto,
      paymentMonto: e.paymentMonto,
    }));

    const movementStats = Array.from(byMovimiento.entries())
      .map(([movimiento, data]) => ({ movimiento, ...data }))
      .sort((a, b) => b.count - a.count);

    const sources = ["v1", "v2", "payment"] as const;
    const sourceStats = sources.map((source) => {
      const count = porFuente[source] ?? 0;
      const monto = montoPorFuente[source] ?? 0;
      return {
        source,
        count,
        monto,
        pctCount: totalPagos > 0 ? (count / totalPagos) * 100 : 0,
        pctMonto: montoTotal > 0 ? (monto / montoTotal) * 100 : 0,
      };
    });

    const byDate = dayEntries
      .filter((e) => e.count > 0)
      .map((e) => ({ date: e.date, count: e.count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    await ctx.runMutation(api.mutations.setMonthStatsFromAggregation, {
      payload: {
        month,
        dayEntries,
        kpis: {
          totalPagos,
          montoTotal,
          referenciasUnicas: referenciasSet.size,
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
      },
    });

    return {
      month,
      totalPagos,
      montoTotal,
      referenciasUnicas: referenciasSet.size,
    };
  },
});

/** Genera lista de meses YYYY-MM entre start y end inclusive. */
function generateMonthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/**
 * Verifica si hay referencias duplicadas en paymentRecords.
 * Itera por mes para respetar límites de lectura.
 */
export const checkDuplicateReferencias = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit: limitArg }) => {
    const maxResults = limitArg ?? 50;
    const months = generateMonthRange("2024-01", "2026-02");
    const countByRef = new Map<string, number>();

    for (const month of months) {
      let cursor: string | undefined;
      do {
        const result = await ctx.runQuery(api.queries.getPaymentRecordsPageByMonth, {
          month,
          cursor,
          numItems: 5000,
        });
        for (const ref of result.page) {
          countByRef.set(ref, (countByRef.get(ref) ?? 0) + 1);
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);
    }

    const duplicates: Array<{ referencia: string; count: number }> = [];
    for (const [ref, count] of countByRef) {
      if (count > 1) {
        duplicates.push({ referencia: ref, count });
      }
    }

    duplicates.sort((a, b) => b.count - a.count);

    let totalRecords = 0;
    for (const [, c] of countByRef) {
      totalRecords += c;
    }

    return {
      totalRecords,
      uniqueReferencias: countByRef.size,
      duplicateReferencias: duplicates.length,
      totalDuplicateRecords: duplicates.reduce((s, d) => s + d.count, 0),
      top: duplicates.slice(0, maxResults),
    };
  },
});

/**
 * Diagnóstico: compara datos de marzo 2025 días 1-6 entre paymentRecords,
 * monthStats y dailyData.
 */
export const diagnoseMarch2025Days1to6 = action({
  args: {},
  handler: async (ctx) => {
    const month = "2025-03";
    const targetDates = ["2025-03-01", "2025-03-02", "2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06"];

    const byDateFromPayments: Record<string, { count: number; monto: number }> = {};
    for (const d of targetDates) {
      byDateFromPayments[d] = { count: 0, monto: 0 };
    }

    let cursor: string | undefined;
    do {
      const result = await ctx.runQuery(api.queries.getPaymentRecordsPageWithDetails, {
        month,
        cursor,
        numItems: 5000,
      });
      for (const r of result.page) {
        const dateStr = r.importDate ?? "";
        if (dateStr && byDateFromPayments[dateStr]) {
          byDateFromPayments[dateStr].count += 1;
          byDateFromPayments[dateStr].monto += r.monto;
        }
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    } while (cursor);

    const monthStats = await ctx.runQuery(api.queries.getMonthStats, { month });
    const dayEntriesFromMonthStats = monthStats?.dailyBreakdown?.days ?? [];
    const byDateFromMonthStats: Record<string, { count: number; monto: number }> = {};
    for (const d of targetDates) {
      byDateFromMonthStats[d] = { count: 0, monto: 0 };
    }
    for (const entry of dayEntriesFromMonthStats) {
      const dateStr = entry.date;
      if (byDateFromMonthStats[dateStr]) {
        byDateFromMonthStats[dateStr] = {
          count: entry.count,
          monto: entry.monto,
        };
      }
    }

    const dailyData = await ctx.runQuery(api.januaryQueries.getDailyDataForDays, {
      year: 2025,
      month: 3,
      days: [1, 2, 3, 4, 5, 6],
    }) as Array<{ day: number; events: number; totalAmount: number }>;
    const byDateFromDailyData: Record<string, { count: number; monto: number }> = {};
    for (const d of targetDates) {
      byDateFromDailyData[d] = { count: 0, monto: 0 };
    }
    for (const row of dailyData) {
      const dateStr = `${month}-${String(row.day).padStart(2, "0")}`;
      if (byDateFromDailyData[dateStr]) {
        byDateFromDailyData[dateStr] = {
          count: row.events,
          monto: row.totalAmount,
        };
      }
    }

    const comparison: Array<{
      date: string;
      paymentRecords: { count: number; monto: number };
      monthStats: { count: number; monto: number };
      dailyData: { count: number; monto: number };
      countMatch: boolean;
      montoMatch: boolean;
      issues: string[];
    }> = [];

    for (const dateStr of targetDates) {
      const pr = byDateFromPayments[dateStr];
      const ms = byDateFromMonthStats[dateStr];
      const dd = byDateFromDailyData[dateStr];
      const issues: string[] = [];
      if (pr.count !== ms.count) {
        issues.push(`count: paymentRecords(${pr.count}) ≠ monthStats(${ms.count})`);
      }
      if (pr.count !== dd.count) {
        issues.push(`count: paymentRecords(${pr.count}) ≠ dailyData(${dd.count})`);
      }
      if (ms.count !== dd.count) {
        issues.push(`count: monthStats(${ms.count}) ≠ dailyData(${dd.count})`);
      }
      if (Math.abs(pr.monto - ms.monto) > 1) {
        issues.push(`monto: paymentRecords(${pr.monto}) ≠ monthStats(${ms.monto})`);
      }
      if (Math.abs(pr.monto - dd.monto) > 1) {
        issues.push(`monto: paymentRecords(${pr.monto}) ≠ dailyData(${dd.monto})`);
      }
      if (Math.abs(ms.monto - dd.monto) > 1) {
        issues.push(`monto: monthStats(${ms.monto}) ≠ dailyData(${dd.monto})`);
      }
      comparison.push({
        date: dateStr,
        paymentRecords: pr,
        monthStats: ms,
        dailyData: dd,
        countMatch: pr.count === ms.count && pr.count === dd.count,
        montoMatch: Math.abs(pr.monto - ms.monto) <= 1 && Math.abs(pr.monto - dd.monto) <= 1,
        issues,
      });
    }

    return {
      month,
      comparison,
      summary: {
        totalPaymentRecords: Object.values(byDateFromPayments).reduce((s, d) => s + d.count, 0),
        totalMonthStats: Object.values(byDateFromMonthStats).reduce((s, d) => s + d.count, 0),
        totalDailyData: Object.values(byDateFromDailyData).reduce((s, d) => s + d.count, 0),
        daysWithIssues: comparison.filter((c) => c.issues.length > 0).length,
      },
    };
  },
});

/**
 * Diagnóstico de todos los meses: compara totales entre paymentRecords,
 * monthStats y dailyData. Detecta meses con datos inconsistentes.
 */
export const diagnoseAllMonths = action({
  args: {},
  handler: async (ctx) => {
    const months = generateMonthRange("2024-01", "2026-02");
    const results: Array<{
      month: string;
      paymentRecords: { count: number; monto: number };
      monthStats: { count: number; monto: number } | null;
      dailyData: { count: number; monto: number };
      hasIssues: boolean;
      issues: string[];
    }> = [];

    for (const month of months) {
      const [year, monthNum] = month.split("-").map(Number);

      let prCount = 0;
      let prMonto = 0;
      let cursor: string | undefined;
      do {
        const result = await ctx.runQuery(api.queries.getPaymentRecordsPageWithDetails, {
          month,
          cursor,
          numItems: 5000,
        });
        for (const r of result.page) {
          prCount += 1;
          prMonto += r.monto;
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);

      const monthStats = await ctx.runQuery(api.queries.getMonthStats, { month });
      const msCount = monthStats?.kpis?.totalPagos ?? 0;
      const msMonto = monthStats?.kpis?.montoTotal ?? 0;

      const ddResult = await ctx.runQuery(api.januaryQueries.getDailyDataMonthlyTotals, {
        year,
        month: monthNum,
      });
      const ddCount = ddResult?.events ?? 0;
      const ddMonto = ddResult?.totalAmount ?? 0;

      const issues: string[] = [];
      if (prCount !== msCount && monthStats) {
        issues.push(`count: paymentRecords(${prCount}) ≠ monthStats(${msCount})`);
      }
      if (prCount !== ddCount) {
        issues.push(`count: paymentRecords(${prCount}) ≠ dailyData(${ddCount})`);
      }
      if (monthStats && msCount !== ddCount) {
        issues.push(`count: monthStats(${msCount}) ≠ dailyData(${ddCount})`);
      }
      if (Math.abs(prMonto - msMonto) > 1 && monthStats) {
        issues.push(`monto: paymentRecords(${prMonto}) ≠ monthStats(${msMonto})`);
      }
      if (Math.abs(prMonto - ddMonto) > 1) {
        issues.push(`monto: paymentRecords(${prMonto}) ≠ dailyData(${ddMonto})`);
      }
      if (monthStats && Math.abs(msMonto - ddMonto) > 1) {
        issues.push(`monto: monthStats(${msMonto}) ≠ dailyData(${ddMonto})`);
      }

      results.push({
        month,
        paymentRecords: { count: prCount, monto: prMonto },
        monthStats: monthStats ? { count: msCount, monto: msMonto } : null,
        dailyData: { count: ddCount, monto: ddMonto },
        hasIssues: issues.length > 0,
        issues,
      });
    }

    const monthsWithIssues = results.filter((r) => r.hasIssues);

    return {
      totalMonths: months.length,
      monthsWithIssues: monthsWithIssues.length,
      monthsWithIssuesList: monthsWithIssues.map((r) => r.month),
      details: monthsWithIssues.map((r) => ({
        month: r.month,
        paymentRecords: r.paymentRecords,
        monthStats: r.monthStats,
        dailyData: r.dailyData,
        issues: r.issues,
      })),
      allResults: results,
    };
  },
});

