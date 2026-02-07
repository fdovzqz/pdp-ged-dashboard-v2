"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import {
  timestampToMexicoParts,
  isWeekend,
} from "./lib/mexicoDate";
import { normalizeWithConfig, toAscii } from "./movementCodes";

const ACTION_TIME_LIMIT_MS = 550_000;
const PAGE_SIZE = 1000;
const BATCH_SIZE = 400;

/* Status filter: PAGADO, PAGO VALIDADO, PA (normalized in normalizeStatus) */
const SOURCE_PRIORITY: Record<string, number> = { payment: 0, v2: 1, v1: 2 };

type PaymentRec = {
  referencia: string;
  monto: number;
  timestamp: string;
  fechaTransaccion: string;
  logSource: "v1" | "v2" | "payment";
  movimiento: string;
  estatus: string;
};

function normalizeStatus(s: string): boolean {
  const u = (s || "").toUpperCase().trim();
  return u === "PAGADO" || u === "PAGO VALIDADO" || u === "PA";
}

function keepRecord(
  existing: PaymentRec | undefined,
  incoming: PaymentRec
): boolean {
  if (!existing) return true;
  const exPri = SOURCE_PRIORITY[existing.logSource] ?? 99;
  const inPri = SOURCE_PRIORITY[incoming.logSource] ?? 99;
  if (inPri < exPri) return true;
  if (inPri > exPri) return false;
  const exTs = existing.timestamp || "";
  const inTs = incoming.timestamp || "";
  return inTs >= exTs;
}

export const buildJanuaryAggregates = action({
  args: {
    months: v.array(v.string()),
  },
  handler: async (ctx, { months }) => {
    const startTime = Date.now();
    const summary: Record<string, { rawHourly: number; daily: number; monthly: number; hourlyDist: number; dailyAmount: number; byMovement: number }> = {};

    for (const monthStr of months) {
      if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
        throw new Error("Límite de tiempo alcanzado (550s).");
      }

      const [year, month] = monthStr.split("-").map(Number);
      if (!year || !month) continue;

      await ctx.runMutation(api.januaryMutations.clearAggregatesForMonth, {
        year,
        month,
      });

      const byRef = new Map<string, PaymentRec>();
      let cursor: string | null = null;

      while (true) {
        const result = (await ctx.runQuery(
          api.queries.getPaymentsByMonthPaginated,
          {
            month: monthStr,
            paginationOpts: { numItems: PAGE_SIZE, cursor },
          }
        )) as {
          page: PaymentRec[];
          isDone: boolean;
          continueCursor: string | null;
        };

        for (const r of result.page) {
          if (!normalizeStatus(r.estatus)) continue;
          const cur = byRef.get(r.referencia);
          if (keepRecord(cur, r)) {
            byRef.set(r.referencia, r);
          }
        }

        if (result.isDone) break;
        cursor = result.continueCursor;
      }

      let config = (await ctx.runQuery(api.movementCodes.getMovementCodesConfig, {})) ?? {
        descriptions: {},
        aliases: {},
      };
      // Sanitizar keys a ASCII (protección si el query devolvió keys con acentos)
      config = {
        descriptions: Object.fromEntries(
          Object.entries(config.descriptions).map(([k, v]) => [toAscii(k) || k, v])
        ),
        aliases: Object.fromEntries(
          Object.entries(config.aliases).map(([k, v]) => [toAscii(k) || k, toAscii(v) || v])
        ),
      };
      const rawHourlyMap = new Map<string, { events: number; totalAmount: number }>();
      const hourlyDistMap = new Map<string, number>();
      const byMovementMap = new Map<string, { totalAmount: number; count: number }>();

      for (const r of byRef.values()) {
        const parts = timestampToMexicoParts(r.timestamp || r.fechaTransaccion || "");
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

        const mov = normalizeWithConfig(r.movimiento, config) || "(sin tipo)";
        const movCur = byMovementMap.get(mov) ?? { totalAmount: 0, count: 0 };
        movCur.totalAmount += r.monto ?? 0;
        movCur.count += 1;
        byMovementMap.set(mov, movCur);
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
      const totalAmount = rawHourlyRecords.reduce((s, r) => s + r.totalAmount, 0);
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

      for (let i = 0; i < rawHourlyRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(api.januaryMutations.batchInsertRawHourly, {
          records: rawHourlyRecords.slice(i, i + BATCH_SIZE),
        });
      }
      for (let i = 0; i < dailyDataRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(api.januaryMutations.batchInsertDailyData, {
          records: dailyDataRecords.slice(i, i + BATCH_SIZE),
        });
      }
      for (const r of monthlyRecords) {
        await ctx.runMutation(api.januaryMutations.batchInsertMonthlyData, {
          records: [r],
        });
      }
      for (let i = 0; i < hourlyDistRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(api.januaryMutations.batchInsertHourlyDistribution, {
          records: hourlyDistRecords.slice(i, i + BATCH_SIZE),
        });
      }
      for (let i = 0; i < dailyAmountRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(api.januaryMutations.batchInsertDailyAmountData, {
          records: dailyAmountRecords.slice(i, i + BATCH_SIZE),
        });
      }
      for (let i = 0; i < amountByMovementRecords.length; i += BATCH_SIZE) {
        await ctx.runMutation(api.januaryMutations.batchInsertAmountByMovement, {
          records: amountByMovementRecords.slice(i, i + BATCH_SIZE),
        });
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
