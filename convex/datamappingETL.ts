"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import {
  datamappingUpdatedAtToParts,
  isWeekend,
} from "./lib/mexicoDate";
import { normalizeWithConfig, toAscii } from "./movementCodes";

const ACTION_TIME_LIMIT_MS = 550_000;
const PAGE_SIZE = 1000;
const BATCH_SIZE = 400;

type DatamappingRec = {
  referencia: string;
  monto: number;
  updatedAt: string;
  tipoMovimiento?: string;
  fuente?: string;
};

/** EVO = Tarjeta de Crédito; DEC y otros = Transferencia (Depósito en Caja). */
function isEvo(fuente: string | undefined): boolean {
  const f = (fuente ?? "").toUpperCase().trim();
  return f === "EVO";
}

/** Normaliza fuente a EVO | DEC | CODI | MIT | NO_DEFINIDO. SPEI se agrupa con SEI - No Definido. */
function normalizeFuente(
  fuente: string | undefined
): "EVO" | "DEC" | "CODI" | "MIT" | "NO_DEFINIDO" {
  const f = (fuente ?? "").toUpperCase().trim();
  if (f === "EVO") return "EVO";
  if (f === "DEC") return "DEC";
  if (f === "CODI") return "CODI";
  if (f === "MIT") return "MIT";
  if (f === "SPEI") return "NO_DEFINIDO";
  return "NO_DEFINIDO";
}

export const buildDatamappingAggregates = action({
  args: {
    months: v.array(v.string()),
  },
  handler: async (ctx, { months }) => {
    const startTime = Date.now();
    const summary: Record<
      string,
      {
        rawHourly: number;
        daily: number;
        monthly: number;
        hourlyDist: number;
        dailyAmount: number;
        byMovement: number;
      }
    > = {};

    for (const monthStr of months) {
      if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
        throw new Error("Límite de tiempo alcanzado (550s).");
      }

      const [year, month] = monthStr.split("-").map(Number);
      if (!year || !month) continue;

      await ctx.runMutation(api.datamappingMutations.clearDatamappingAggregatesForMonth, {
        year,
        month,
      });

      const records: DatamappingRec[] = [];
      let cursor: string | null = null;

      while (true) {
        const result = (await ctx.runQuery(
          api.queries.getDatamappingRecordsByMonthPaginated,
          {
            month: monthStr,
            paginationOpts: { numItems: PAGE_SIZE, cursor },
          }
        )) as {
          page: DatamappingRec[];
          isDone: boolean;
          continueCursor: string | null;
        };

        records.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
      }

      let config =
        (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
          descriptions: {},
          aliases: {},
        };
      config = {
        descriptions: Object.fromEntries(
          Object.entries(config.descriptions).map(([k, v]) => [toAscii(k) || k, v])
        ),
        aliases: Object.fromEntries(
          Object.entries(config.aliases).map(([k, v]) => [
            toAscii(k) || k,
            toAscii(v) || v,
          ])
        ),
      };

      const rawHourlyMap = new Map<
        string,
        { events: number; totalAmount: number }
      >();
      const hourlyDistMap = new Map<string, number>();
      const byMovementMap = new Map<
        string,
        { totalAmount: number; count: number }
      >();
      const dailySourceMap = new Map<
        string,
        { evoCount: number; evoMonto: number; ventanillaCount: number; ventanillaMonto: number }
      >();
      const dailyFuenteMap = new Map<string, Map<string, { count: number; monto: number }>>();

      for (const r of records) {
        const parts = datamappingUpdatedAtToParts(r.updatedAt || "");
        if (!parts || parts.month !== month || parts.year !== year) continue;

        const key = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`;
        const cur = rawHourlyMap.get(key) ?? { events: 0, totalAmount: 0 };
        cur.events += 1;
        cur.totalAmount += r.monto ?? 0;
        rawHourlyMap.set(key, cur);

        const dayType = isWeekend(parts.year, parts.month, parts.day)
          ? "weekend"
          : "weekday";
        const hKey = `${parts.year}-${parts.month}-${dayType}-${parts.hour}`;
        hourlyDistMap.set(hKey, (hourlyDistMap.get(hKey) ?? 0) + 1);

        const mov =
          normalizeWithConfig(r.tipoMovimiento ?? "", config) || "(sin tipo)";
        const movCur = byMovementMap.get(mov) ?? {
          totalAmount: 0,
          count: 0,
        };
        movCur.totalAmount += r.monto ?? 0;
        movCur.count += 1;
        byMovementMap.set(mov, movCur);

        const dKey = `${parts.year}-${parts.month}-${parts.day}`;
        const src = dailySourceMap.get(dKey) ?? {
          evoCount: 0,
          evoMonto: 0,
          ventanillaCount: 0,
          ventanillaMonto: 0,
        };
        const monto = r.monto ?? 0;
        if (isEvo(r.fuente)) {
          src.evoCount += 1;
          src.evoMonto += monto;
        } else {
          src.ventanillaCount += 1;
          src.ventanillaMonto += monto;
        }
        dailySourceMap.set(dKey, src);

        const fuente = normalizeFuente(r.fuente);
        let dayFuente = dailyFuenteMap.get(dKey);
        if (!dayFuente) {
          dayFuente = new Map();
          dailyFuenteMap.set(dKey, dayFuente);
        }
        const fuCur = dayFuente.get(fuente) ?? { count: 0, monto: 0 };
        fuCur.count += 1;
        fuCur.monto += monto;
        dayFuente.set(fuente, fuCur);
      }

      const rawHourlyRecords: Array<{
        year: number;
        month: number;
        day: number;
        hour: number;
        events: number;
        totalAmount: number;
      }> = [];
      for (const [key, v] of rawHourlyMap) {
        const [y, m, d, h] = key.split("-").map(Number);
        rawHourlyRecords.push({
          year: y,
          month: m,
          day: d,
          hour: h,
          events: v.events,
          totalAmount: v.totalAmount,
        });
      }

      const today = new Date();
      const todayY = today.getFullYear();
      const todayM = today.getMonth() + 1;
      const todayD = today.getDate();

      const dailyMap = new Map<
        string,
        { events: number; totalAmount: number; transactionCount: number }
      >();
      for (const r of rawHourlyRecords) {
        const dKey = `${r.year}-${r.month}-${r.day}`;
        const cur = dailyMap.get(dKey) ?? {
          events: 0,
          totalAmount: 0,
          transactionCount: 0,
        };
        cur.events += r.events;
        cur.totalAmount += r.totalAmount;
        cur.transactionCount += r.events;
        dailyMap.set(dKey, cur);
      }

      const dailyDataRecords: Array<{
        year: number;
        month: number;
        day: number;
        events: number;
        totalAmount: number;
        transactionCount: number;
        isComplete: boolean;
      }> = [];
      for (const [key, v] of dailyMap) {
        const [y, m, d] = key.split("-").map(Number);
        const isComplete =
          y < todayY ||
          (y === todayY && m < todayM) ||
          (y === todayY && m === todayM && d < todayD);
        dailyDataRecords.push({
          year: y,
          month: m,
          day: d,
          events: v.events,
          totalAmount: v.totalAmount,
          transactionCount: v.transactionCount,
          isComplete,
        });
      }

      const totalEvents = rawHourlyRecords.reduce((s, r) => s + r.events, 0);
      const totalAmount = rawHourlyRecords.reduce(
        (s, r) => s + r.totalAmount,
        0
      );
      const monthlyRecords = [
        { year, month, events: totalEvents, totalAmount },
      ];

      const hourlyDistRecords: Array<{
        year: number;
        month: number;
        dayType: string;
        hour: number;
        events: number;
      }> = [];
      for (const [key, events] of hourlyDistMap) {
        const parts = key.split("-");
        const h = parseInt(parts[3], 10);
        hourlyDistRecords.push({
          year: parseInt(parts[0], 10),
          month: parseInt(parts[1], 10),
          dayType: parts[2],
          hour: h,
          events,
        });
      }

      const dailyAmountRecords = dailyDataRecords.map((d) => ({
        year: d.year,
        month: d.month,
        day: d.day,
        totalAmount: d.totalAmount,
        transactionCount: d.transactionCount,
      }));

      const amountByMovementRecords = Array.from(byMovementMap.entries()).map(
        ([movimiento, v]) => ({
          year,
          month,
          movimiento: toAscii(movimiento) || "(sin tipo)",
          totalAmount: v.totalAmount,
          count: v.count,
        })
      );

      const dailySourceRecords = Array.from(dailySourceMap.entries()).map(
        ([dKey, v]) => {
          const [y, m, d] = dKey.split("-").map(Number);
          return {
            year: y,
            month: m,
            day: d,
            evoCount: v.evoCount,
            evoMonto: v.evoMonto,
            ventanillaCount: v.ventanillaCount,
            ventanillaMonto: v.ventanillaMonto,
          };
        }
      );

      const dailyFuenteRecords: Array<{
        year: number;
        month: number;
        day: number;
        fuente: string;
        count: number;
        monto: number;
      }> = [];
      for (const [dKey, dayFuente] of dailyFuenteMap) {
        const [y, m, d] = dKey.split("-").map(Number);
        for (const [fuente, v] of dayFuente) {
          dailyFuenteRecords.push({
            year: y,
            month: m,
            day: d,
            fuente,
            count: v.count,
            monto: v.monto,
          });
        }
      }

      for (let i = 0; i < rawHourlyRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertRawHourlyDatamapping,
          {
            records: rawHourlyRecords.slice(i, i + BATCH_SIZE),
          }
        );
      }
      for (let i = 0; i < dailyDataRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertDailyDataDatamapping,
          {
            records: dailyDataRecords.slice(i, i + BATCH_SIZE),
          }
        );
      }
      for (const r of monthlyRecords) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertMonthlyDataDatamapping,
          {
            records: [r],
          }
        );
      }
      for (let i = 0; i < hourlyDistRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertHourlyDistributionDatamapping,
          {
            records: hourlyDistRecords.slice(i, i + BATCH_SIZE),
          }
        );
      }
      for (let i = 0; i < dailyAmountRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertDailyAmountDataDatamapping,
          {
            records: dailyAmountRecords.slice(i, i + BATCH_SIZE),
          }
        );
      }
      for (let i = 0; i < amountByMovementRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertAmountByMovementDatamapping,
          {
            records: amountByMovementRecords.slice(i, i + BATCH_SIZE),
          }
        );
      }
      for (let i = 0; i < dailySourceRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertDailySourceBreakdown,
          {
            records: dailySourceRecords.slice(i, i + BATCH_SIZE),
          }
        );
      }
      for (let i = 0; i < dailyFuenteRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(
          api.datamappingMutations.batchInsertDailyFuenteBreakdown,
          {
            records: dailyFuenteRecords.slice(i, i + BATCH_SIZE),
          }
        );
      }

      summary[monthStr] = {
        rawHourly: rawHourlyRecords.length,
        daily: dailyDataRecords.length,
        monthly: monthlyRecords.length,
        hourlyDist: hourlyDistRecords.length,
        dailyAmount: dailyAmountRecords.length,
        byMovement: amountByMovementRecords.length,
      };
    }

    return { summary, totalRecords: Object.keys(summary).length };
  },
});
