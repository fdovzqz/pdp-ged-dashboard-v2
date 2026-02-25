"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { timestampToMexicoMonth } from "./lib/mexicoDate";

/** Límite Convex: 600 segundos por acción. */
const ACTION_TIME_LIMIT_MS = 550_000;

const RECONCILIATION_CW_PAGE = 5000;
const RECONCILIATION_DDB_PAGE = 500;
const RECONCILIATION_ERRORS_COUNT_PAGE = 2000;

/** Siguiente mes en formato YYYY-MM. */
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Lista de meses entre start y end (YYYY-MM) inclusive. */
function listMonthsInRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = nextMonth(cur);
  }
  return out;
}

/** Rango UTC para un mes en hora México (UTC-6): [día 1 00:00, día 1 siguiente 00:00). */
function monthToUtcRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 6, 0, 0, 0));
  const to = new Date(Date.UTC(y, m, 1, 6, 0, 0, 0));
  return {
    from: from.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    to: to.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  };
}

/** Rango YYYY-MM-DD para mes transaccional (fechaTransaccionMexico). */
function monthToFechaTransaccionRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { from, to };
}

/**
 * Reconciliación: paymentRecords vs datamappingRecords en Convex.
 * Scope: "universe" (todo), "month" (un mes), "period" (rango de meses).
 */
export const runReconciliation = action({
  args: {
    scope: v.union(v.literal("universe"), v.literal("month"), v.literal("period")),
    month: v.optional(v.string()),
    startMonth: v.optional(v.string()),
    endMonth: v.optional(v.string()),
    /** Si true, en scope month/period se usa fechaTransaccionMexico para DDB (mes transaccional). Por defecto false (updatedAt). */
    useTransactionMonthForDdb: v.optional(v.boolean()),
  },
  handler: async (ctx, { scope, month, startMonth, endMonth, useTransactionMonthForDdb = false }) => {
    const startMs = Date.now();

    let scopeId: string;
    let cwMonths: string[];
    let ddbFrom: string | undefined;
    let ddbTo: string | undefined;
    let ddbFechaFrom: string | undefined;
    let ddbFechaTo: string | undefined;

    if (scope === "universe") {
      scopeId = "universe";
      const allMonths = (await ctx.runQuery(api.cloudwatchQueries.getAllMonthsStatus, {})) as { month: string }[];
      cwMonths = allMonths.map((m) => m.month).sort();
      if (cwMonths.length === 0) {
        throw new Error("No hay meses cargados en monthStats. Carga datos primero.");
      }
      ddbFrom = undefined;
      ddbTo = undefined;
      ddbFechaFrom = undefined;
      ddbFechaTo = undefined;
    } else if (scope === "month") {
      if (!month) throw new Error("scope 'month' requiere month (YYYY-MM).");
      scopeId = month;
      cwMonths = [month];
      const r = monthToUtcRange(month);
      ddbFrom = r.from;
      ddbTo = r.to;
      if (useTransactionMonthForDdb) {
        const fr = monthToFechaTransaccionRange(month);
        ddbFechaFrom = fr.from;
        ddbFechaTo = fr.to;
      }
    } else {
      if (!startMonth || !endMonth) throw new Error("scope 'period' requiere startMonth y endMonth (YYYY-MM).");
      if (startMonth > endMonth) throw new Error("startMonth debe ser <= endMonth.");
      scopeId = `${startMonth}::${endMonth}`;
      cwMonths = listMonthsInRange(startMonth, endMonth);
      const rStart = monthToUtcRange(startMonth);
      const rEnd = monthToUtcRange(nextMonth(endMonth));
      ddbFrom = rStart.from;
      ddbTo = rEnd.to;
      if (useTransactionMonthForDdb) {
        ddbFechaFrom = `${startMonth}-01`;
        ddbFechaTo = `${nextMonth(endMonth)}-01`;
      }
    }

    const byRefCw = new Map<
      string,
      {
        monto: number;
        logSource: "payment" | "v1" | "v2";
        importMonth: string;
        timestamp: string;
      }
    >();
    const order: Record<string, number> = { payment: 0, v2: 1, v1: 2 };
    let cwTotalRecords = 0;

    for (const m of cwMonths) {
      let cwCursor: string | null = null;
      do {
        if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
          throw new Error("Límite de tiempo alcanzado. Reconciliación incompleta.");
        }
        const cwResult = (await ctx.runQuery(
          api.cloudwatchQueries.getPaymentRecordsPageWithDetails,
          {
            month: m,
            cursor: cwCursor ?? undefined,
            numItems: RECONCILIATION_CW_PAGE,
          }
        )) as {
          page: Array<{
            referencia: string;
            monto: number;
            logSource: string;
            importMonth?: string;
            timestamp?: string;
          }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        cwTotalRecords += cwResult.page.length;
        for (const r of cwResult.page) {
          const existing = byRefCw.get(r.referencia);
          if (
            !existing ||
            order[r.logSource] < order[existing.logSource as keyof typeof order]
          ) {
            byRefCw.set(r.referencia, {
              monto: r.monto,
              logSource: r.logSource as "payment" | "v1" | "v2",
              importMonth: r.importMonth ?? "",
              timestamp: r.timestamp ?? "",
            });
          }
        }
        if (cwResult.isDone) break;
        cwCursor = cwResult.continueCursor ?? null;
      } while (true);
    }

    const bySource = { payment: 0, v1: 0, v2: 0 };
    for (const [, { logSource }] of byRefCw) {
      bySource[logSource]++;
    }

    const byRefDdb = new Map<string, { monto: number; updatedAt: string }>();
    let ddbTotalRecords = 0;
    let ddbCursor: string | null = null;

    const useFechaTransaccion = ddbFechaFrom !== undefined && ddbFechaTo !== undefined;
    type DdbPageResult = {
      page: Array<{ referencia: string; monto: number; updatedAt: string }>;
      isDone: boolean;
      continueCursor: string | null;
    };
    do {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) {
        throw new Error("Límite de tiempo alcanzado. Reconciliación incompleta.");
      }
      const ddbResult: DdbPageResult = useFechaTransaccion
        ? ((await ctx.runQuery(api.datamappingQueries.getDatamappingPageByFechaTransaccionMexicoRange, {
            fechaFrom: ddbFechaFrom!,
            fechaTo: ddbFechaTo!,
            cursor: ddbCursor,
            numItems: RECONCILIATION_DDB_PAGE,
          })) as DdbPageResult)
        : ((await ctx.runQuery(api.datamappingQueries.getDatamappingPageByDateRange, {
            updatedAtFrom: ddbFrom,
            updatedAtTo: ddbTo,
            cursor: ddbCursor,
            numItems: RECONCILIATION_DDB_PAGE,
          })) as DdbPageResult);
      ddbTotalRecords += ddbResult.page.length;
      for (const r of ddbResult.page) {
        byRefDdb.set(r.referencia, { monto: r.monto, updatedAt: r.updatedAt });
      }
      if (ddbResult.isDone) break;
      ddbCursor = ddbResult.continueCursor ?? null;
    } while (true);

    const onlyInCloudWatch: string[] = [];
    const onlyInDynamoDB: string[] = [];
    const inBothMatch: Array<{ referencia: string; monto: number }> = [];
    const inBothMonthMismatch: Array<{
      referencia: string;
      monto: number;
      importMonth: string;
      datamappingUpdatedAt: string;
      logSource: string;
    }> = [];
    const inBothMismatch: Array<{
      referencia: string;
      montoCloudWatch: number;
      montoDynamoDB: number;
      logSource: string;
    }> = [];

    for (const [ref, { monto, logSource, importMonth, timestamp }] of byRefCw) {
      if (!byRefDdb.has(ref)) {
        onlyInCloudWatch.push(ref);
      } else {
        const ddb = byRefDdb.get(ref)!;
        const cwMonth =
          timestamp && /^\d{4}/.test(timestamp)
            ? timestampToMexicoMonth(timestamp)
            : (importMonth ?? "").substring(0, 7);
        const ddbMonth = timestampToMexicoMonth(ddb.updatedAt ?? "");
        const sameMonth = cwMonth !== "" && ddbMonth !== "" && cwMonth === ddbMonth;
        if (monto === ddb.monto) {
          if (sameMonth) {
            inBothMatch.push({ referencia: ref, monto });
          } else {
            inBothMonthMismatch.push({
              referencia: ref,
              monto,
              importMonth: (cwMonth || importMonth) ?? "",
              datamappingUpdatedAt: ddb.updatedAt,
              logSource,
            });
          }
        } else {
          inBothMismatch.push({
            referencia: ref,
            montoCloudWatch: monto,
            montoDynamoDB: ddb.monto,
            logSource,
          });
        }
      }
    }
    for (const [ref] of byRefDdb) {
      if (!byRefCw.has(ref)) onlyInDynamoDB.push(ref);
    }

    const LOOKUP_CHUNK = 300;
    let onlyInDynamoDBFiltered = onlyInDynamoDB;
    if (onlyInDynamoDB.length > 0) {
      const cwMonthsByRef: Record<string, string> = {};
      for (let i = 0; i < onlyInDynamoDB.length; i += LOOKUP_CHUNK) {
        const chunk = onlyInDynamoDB.slice(i, i + LOOKUP_CHUNK);
        const part = (await ctx.runQuery(
          api.cloudwatchQueries.getPaymentRecordsMonthsForReferencias,
          { referencias: chunk }
        )) as Record<string, string>;
        Object.assign(cwMonthsByRef, part);
      }
      for (const ref of Object.keys(cwMonthsByRef)) {
        const ddb = byRefDdb.get(ref)!;
        inBothMonthMismatch.push({
          referencia: ref,
          monto: ddb.monto,
          importMonth: cwMonthsByRef[ref] ?? "",
          datamappingUpdatedAt: ddb.updatedAt,
          logSource: "",
        });
      }
      onlyInDynamoDBFiltered = onlyInDynamoDB.filter((ref) => !(ref in cwMonthsByRef));
    }

    let onlyInCloudWatchFiltered = onlyInCloudWatch;
    if (onlyInCloudWatch.length > 0) {
      const ddbUpdatedAtByRef: Record<string, string> = {};
      for (let i = 0; i < onlyInCloudWatch.length; i += LOOKUP_CHUNK) {
        const chunk = onlyInCloudWatch.slice(i, i + LOOKUP_CHUNK);
        const part = (await ctx.runQuery(
          api.datamappingQueries.getDatamappingUpdatedAtForReferencias,
          { referencias: chunk }
        )) as Record<string, string>;
        Object.assign(ddbUpdatedAtByRef, part);
      }
      for (const ref of Object.keys(ddbUpdatedAtByRef)) {
        const cw = byRefCw.get(ref)!;
        inBothMonthMismatch.push({
          referencia: ref,
          monto: cw.monto,
          importMonth: cw.importMonth ?? "",
          datamappingUpdatedAt: ddbUpdatedAtByRef[ref] ?? "",
          logSource: cw.logSource,
        });
      }
      onlyInCloudWatchFiltered = onlyInCloudWatch.filter((ref) => !(ref in ddbUpdatedAtByRef));
    }

    const onlyCwBySource = { payment: 0, v1: 0, v2: 0 };
    for (const ref of onlyInCloudWatchFiltered) {
      const s = byRefCw.get(ref)?.logSource;
      if (s) onlyCwBySource[s]++;
    }

    const matchCount = inBothMatch.length;
    const onlyCwCount = onlyInCloudWatchFiltered.length;
    const onlyDdbCount = onlyInDynamoDBFiltered.length;
    const mismatchCount = inBothMismatch.length;
    const monthMismatchCount = inBothMonthMismatch.length;

    let cleared: { deleted: number };
    do {
      cleared = (await ctx.runMutation(
        api.reconciliationMutations.clearReconciliationBatch,
        {}
      )) as { deleted: number };
    } while (cleared.deleted >= 400);

    await ctx.runMutation(api.reconciliationMutations.setReconciliationSummary, {
      scopeId,
      matchCount,
      onlyCwCount,
      onlyDdbCount,
      mismatchCount,
      monthMismatchCount,
      totalUnique: byRefCw.size + byRefDdb.size,
    });

    const BATCH = 400;
    const onlyCwRecords = onlyInCloudWatchFiltered.map((ref) => {
      const x = byRefCw.get(ref)!;
      const cwMonthMexico =
        x.timestamp && /^\d{4}/.test(x.timestamp)
          ? timestampToMexicoMonth(x.timestamp)
          : (x.importMonth ?? "").substring(0, 7);
      return {
        kind: "onlyCw" as const,
        referencia: ref,
        monto: x.monto,
        logSource: x.logSource,
        importMonth: cwMonthMexico || x.importMonth || undefined,
      };
    });
    const onlyDdbRecords = onlyInDynamoDBFiltered.map((ref) => {
      const d = byRefDdb.get(ref)!;
      return {
        kind: "onlyDdb" as const,
        referencia: ref,
        monto: d.monto,
        datamappingUpdatedAt: d.updatedAt,
      };
    });
    const mismatchRecords = inBothMismatch.map((r) => {
      const cw = byRefCw.get(r.referencia)!;
      const ddb = byRefDdb.get(r.referencia)!;
      const cwMonthMexico =
        cw.timestamp && /^\d{4}/.test(cw.timestamp)
          ? timestampToMexicoMonth(cw.timestamp)
          : (cw.importMonth ?? "").substring(0, 7);
      return {
        kind: "mismatch" as const,
        referencia: r.referencia,
        montoCloudWatch: r.montoCloudWatch,
        montoDynamoDB: r.montoDynamoDB,
        logSource: r.logSource,
        importMonth: cwMonthMexico || cw.importMonth || undefined,
        datamappingUpdatedAt: ddb.updatedAt,
      };
    });
    const monthMismatchRecords = inBothMonthMismatch.map((r) => ({
      kind: "monthMismatch" as const,
      referencia: r.referencia,
      monto: r.monto,
      logSource: r.logSource,
      importMonth: r.importMonth || undefined,
      datamappingUpdatedAt: r.datamappingUpdatedAt,
    }));
    for (let i = 0; i < onlyCwRecords.length; i += BATCH) {
      await ctx.runMutation(api.reconciliationMutations.insertReconciliationErrorsBatch, {
        records: onlyCwRecords.slice(i, i + BATCH),
      });
    }
    for (let i = 0; i < onlyDdbRecords.length; i += BATCH) {
      await ctx.runMutation(api.reconciliationMutations.insertReconciliationErrorsBatch, {
        records: onlyDdbRecords.slice(i, i + BATCH),
      });
    }
    for (let i = 0; i < mismatchRecords.length; i += BATCH) {
      await ctx.runMutation(api.reconciliationMutations.insertReconciliationErrorsBatch, {
        records: mismatchRecords.slice(i, i + BATCH),
      });
    }
    for (let i = 0; i < monthMismatchRecords.length; i += BATCH) {
      await ctx.runMutation(api.reconciliationMutations.insertReconciliationErrorsBatch, {
        records: monthMismatchRecords.slice(i, i + BATCH),
      });
    }

    return {
      scopeId,
      cloudWatch: {
        totalRecords: cwTotalRecords,
        uniqueReferencias: byRefCw.size,
        bySourceRecords: bySource,
        bySourceUniqueRefs: {
          payment: bySource.payment,
          v1: bySource.v1,
          v2: bySource.v2,
        },
      },
      datamapping: {
        totalRecords: ddbTotalRecords,
        uniqueReferencias: byRefDdb.size,
        filter: useFechaTransaccion
          ? { fechaTransaccionMexicoFrom: ddbFechaFrom!, fechaTransaccionMexicoTo: ddbFechaTo! }
          : { updatedAtFrom: ddbFrom ?? "(todo)", updatedAtTo: ddbTo ?? "(todo)" },
        useTransactionMonth: useFechaTransaccion,
        truncated: false,
      },
      differences: {
        onlyInCloudWatch: onlyCwCount,
        onlyInDynamoDB: onlyDdbCount,
        inBothMatch: matchCount,
        inBothMismatch: mismatchCount,
        inBothMonthMismatch: monthMismatchCount,
        onlyInCloudWatchBySource: onlyCwBySource,
      },
      summary: {
        matchCount,
        onlyCwCount,
        onlyDdbCount,
        mismatchCount,
        monthMismatchCount,
        totalUnique: byRefCw.size + byRefDdb.size,
      },
      samples: {
        onlyInCloudWatch: onlyInCloudWatchFiltered.slice(0, 100),
        onlyInDynamoDB: onlyInDynamoDBFiltered.slice(0, 100),
        inBothMismatch: inBothMismatch.slice(0, 50),
        inBothMonthMismatch: inBothMonthMismatch.slice(0, 50),
        inBothMatch: inBothMatch.slice(0, 30),
      },
    };
  },
});

/** Diagnóstico de diferencias por mes: paymentRecords vs datamapping por updatedAt y por fechaTransaccion. */
export const getReconciliationDiagnosticsByMonth = action({
  args: { months: v.optional(v.array(v.string())) },
  handler: async (ctx, { months: monthsArg }): Promise<{
    byMonth: Array<{
      month: string;
      paymentRecords: number;
      datamappingByUpdatedAt: { pv: number; pvDec: number; pvMenosDec: number };
      datamappingByFechaTransaccion: { pv: number; pvDec: number; pvMenosDec: number };
      diferenciaByUpdatedAt: number;
      diferenciaByFechaTransaccion: number;
    }>;
    note: string;
  }> => {
    const months = monthsArg?.length ? monthsArg.sort() : ["2025-12", "2026-01", "2026-02"];
    const startMs = Date.now();
    const isDec = (fuente: string | undefined) => (fuente ?? "").trim().toUpperCase() === "DEC";

    const cwStats = (await ctx.runQuery(api.cloudwatchQueries.getAllMonthsStatus, {})) as {
      month: string;
      totalRecords: number;
    }[];
    const cwByMonth = new Map(cwStats.map((s) => [s.month, s.totalRecords]));

    const dmStats = (await ctx.runQuery(api.datamappingQueries.getAllDatamappingMonthsStatus, {})) as {
      month: string;
      totalRecords: number;
      totalRecordsPagoValidado?: number;
      totalRecordsPagoValidadoDec?: number;
    }[];
    const dmByMonth = new Map(
      dmStats.map((s) => [
        s.month,
        { pv: s.totalRecordsPagoValidado ?? s.totalRecords, pvDec: s.totalRecordsPagoValidadoDec ?? 0 },
      ])
    );

    const byMonth: Array<{
      month: string;
      paymentRecords: number;
      datamappingByUpdatedAt: { pv: number; pvDec: number; pvMenosDec: number };
      datamappingByFechaTransaccion: { pv: number; pvDec: number; pvMenosDec: number };
      diferenciaByUpdatedAt: number;
      diferenciaByFechaTransaccion: number;
    }> = [];

    for (const month of months) {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) break;
      const paymentRecords = cwByMonth.get(month) ?? 0;
      const dmUpd = dmByMonth.get(month);
      const pvUpd = dmUpd?.pv ?? 0;
      const pvDecUpd = dmUpd?.pvDec ?? 0;
      const pvMenosDecUpd = pvUpd - pvDecUpd;

      let pvFt = 0;
      let pvDecFt = 0;
      let cursor: string | null = null;
      do {
        const result = (await ctx.runQuery(
          api.datamappingQueries.getDatamappingRecordsByMonthPaginated,
          { month, paginationOpts: { numItems: 1000, cursor }, useFechaTransaccion: true }
        )) as { page: Array<{ fuente?: string }>; isDone: boolean; continueCursor: string | null };
        for (const r of result.page) {
          pvFt += 1;
          if (isDec(r.fuente)) pvDecFt += 1;
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      } while (cursor);

      const pvMenosDecFt = pvFt - pvDecFt;
      byMonth.push({
        month,
        paymentRecords,
        datamappingByUpdatedAt: { pv: pvUpd, pvDec: pvDecUpd, pvMenosDec: pvMenosDecUpd },
        datamappingByFechaTransaccion: { pv: pvFt, pvDec: pvDecFt, pvMenosDec: pvMenosDecFt },
        diferenciaByUpdatedAt: paymentRecords - pvMenosDecUpd,
        diferenciaByFechaTransaccion: paymentRecords - pvMenosDecFt,
      });
    }

    return {
      byMonth,
      note:
        "paymentRecords = mes del pago. updatedAt = mes de actualización en DynamoDB. fechaTransaccion = mes del pago en datamapping. Si diferenciaByFechaTransaccion ~0, la diferencia en UI es por criterio de mes.",
    };
  },
});

/** Devuelve el número de errores por mes para un tipo (onlyCw | onlyDdb | mismatch | monthMismatch). */
export const getReconciliationErrorsCountByMonth = action({
  args: {
    kind: v.union(
      v.literal("onlyCw"),
      v.literal("onlyDdb"),
      v.literal("mismatch"),
      v.literal("monthMismatch")
    ),
  },
  handler: async (ctx, { kind }): Promise<{ countsByMonth: Record<string, number> }> => {
    const countsByMonth: Record<string, number> = {};
    let cursor: string | null = null;
    do {
      const result = (await ctx.runQuery(api.reconciliationQueries.getReconciliationErrorsPage, {
        kind,
        cursor,
        numItems: RECONCILIATION_ERRORS_COUNT_PAGE,
      })) as {
        page: Array<{
          importMonth?: string;
          datamappingUpdatedAt?: string;
        }>;
        isDone: boolean;
        continueCursor: string | null;
      };
      for (const doc of result.page) {
        const month =
          (doc.importMonth != null && doc.importMonth !== ""
            ? doc.importMonth.substring(0, 7)
            : null) ??
          (doc.datamappingUpdatedAt != null && doc.datamappingUpdatedAt !== ""
            ? timestampToMexicoMonth(doc.datamappingUpdatedAt)
            : null) ??
          "—";
        countsByMonth[month] = (countsByMonth[month] ?? 0) + 1;
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    } while (true);
    return { countsByMonth };
  },
});

function isDecFuente(fuente: string | undefined): boolean {
  return (fuente ?? "").trim().toUpperCase() === "DEC";
}

/**
 * Reconciliación detallada por periodo: desglosa las diferencias (refs en DataMapping PV-DEC que no están en CloudWatch
 * en ese periodo) en categorías y confirma status/origen de fecha. Responde a:
 * 1) Qué transacciones son la diferencia (onlyInDdb)
 * 2) Duplicados en CW y en DDB
 * 3) Confirmación PAGO VALIDADO (y no DEC)
 * 4) Si tienen match en CloudWatch o usaron fecha de updatedAt
 */
export const getReconciliationBreakdownForPeriod = action({
  args: {
    startMonth: v.string(),
    endMonth: v.string(),
  },
  handler: async (
    ctx,
    { startMonth, endMonth }
  ): Promise<{
    period: { startMonth: string; endMonth: string };
    summary: {
      totalCwRecords: number;
      uniqueCwRefs: number;
      totalDdbRecordsPvMinusDec: number;
      uniqueDdbRefsPvMinusDec: number;
      onlyInDdbCount: number;
      diferencia: number;
    };
    onlyInDdbBreakdown: Array<{
      referencia: string;
      monto: number;
      categoria: "soloEnDataMapping" | "enCloudWatchOtroMes";
      cwImportMonth?: string;
      fechaTransaccionOrigen: "cloudWatch" | "updatedAt" | "indeterminado";
      ddbFechaTransaccionMexico: string;
    }>;
    duplicateCwRefs: string[];
    duplicateDdbRefs: string[];
    confirmacionPagoValidado: string;
  }> => {
    if (startMonth > endMonth) throw new Error("startMonth debe ser <= endMonth.");
    const months = listMonthsInRange(startMonth, endMonth);
    const startMs = Date.now();
    const order: Record<string, number> = { payment: 0, v2: 1, v1: 2 };

    const byRefCw = new Map<
      string,
      { monto: number; importMonth: string; timestamp: string; logSource: string }
    >();
    const cwRefCount = new Map<string, number>();
    let totalCwRecords = 0;

    for (const m of months) {
      let cwCursor: string | null = null;
      do {
        if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) throw new Error("Límite de tiempo alcanzado.");
        const cwResult = (await ctx.runQuery(
          api.cloudwatchQueries.getPaymentRecordsPageWithDetails,
          { month: m, cursor: cwCursor ?? undefined, numItems: RECONCILIATION_CW_PAGE }
        )) as {
          page: Array<{ referencia: string; monto: number; logSource: string; importMonth?: string; timestamp?: string }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        totalCwRecords += cwResult.page.length;
        for (const r of cwResult.page) {
          cwRefCount.set(r.referencia, (cwRefCount.get(r.referencia) ?? 0) + 1);
          const existing = byRefCw.get(r.referencia);
          if (
            !existing ||
            order[r.logSource as keyof typeof order] < order[existing.logSource as keyof typeof order]
          ) {
            byRefCw.set(r.referencia, {
              monto: r.monto,
              importMonth: (r.importMonth ?? "").substring(0, 7),
              timestamp: r.timestamp ?? "",
              logSource: r.logSource,
            });
          }
        }
        if (cwResult.isDone) break;
        cwCursor = cwResult.continueCursor ?? null;
      } while (true);
    }

    const byRefDdb = new Map<
      string,
      { monto: number; updatedAt: string; fechaTransaccionMexico: string }
    >();
    const ddbRefCount = new Map<string, number>();
    let totalDdbRecordsPvMinusDec = 0;

    for (const month of months) {
      let ddbCursor: string | null = null;
      do {
        if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) throw new Error("Límite de tiempo alcanzado.");
        const ddbResult = (await ctx.runQuery(
          api.datamappingQueries.getDatamappingRecordsByMonthPaginated,
          { month, paginationOpts: { numItems: 500, cursor: ddbCursor }, useFechaTransaccion: true }
        )) as {
          page: Array<{
            referencia: string;
            monto: number;
            updatedAt: string;
            fechaTransaccionMexico?: string;
            fuente?: string;
          }>;
          isDone: boolean;
          continueCursor: string | null;
        };
        for (const r of ddbResult.page) {
          if (isDecFuente(r.fuente)) continue;
          totalDdbRecordsPvMinusDec += 1;
          ddbRefCount.set(r.referencia, (ddbRefCount.get(r.referencia) ?? 0) + 1);
          byRefDdb.set(r.referencia, {
            monto: r.monto,
            updatedAt: r.updatedAt,
            fechaTransaccionMexico: r.fechaTransaccionMexico ?? "",
          });
        }
        if (ddbResult.isDone) break;
        ddbCursor = ddbResult.continueCursor;
      } while (ddbCursor);
    }

    const onlyInDdb = [...byRefDdb.keys()].filter((ref) => !byRefCw.has(ref));
    const diferencia = byRefCw.size - byRefDdb.size;

    const duplicateCwRefs = [...cwRefCount.entries()].filter(([, n]) => n > 1).map(([ref]) => ref);
    const duplicateDdbRefs = [...ddbRefCount.entries()].filter(([, n]) => n > 1).map(([ref]) => ref);

    const DETAIL_CHUNK = 400;
    const onlyInDdbBreakdown: Array<{
      referencia: string;
      monto: number;
      categoria: "soloEnDataMapping" | "enCloudWatchOtroMes";
      cwImportMonth?: string;
      fechaTransaccionOrigen: "cloudWatch" | "updatedAt" | "indeterminado";
      ddbFechaTransaccionMexico: string;
    }> = [];

    for (let i = 0; i < onlyInDdb.length; i += DETAIL_CHUNK) {
      if (Date.now() - startMs > ACTION_TIME_LIMIT_MS) break;
      const chunk = onlyInDdb.slice(i, i + DETAIL_CHUNK);
      const cwDetails = (await ctx.runQuery(api.cloudwatchQueries.getPaymentRecordDetailsForReferencias, {
        referencias: chunk,
      })) as Record<string, { importMonth: string; fechaTransaccion: string }>;

      for (const ref of chunk) {
        const ddb = byRefDdb.get(ref)!;
        const cw = cwDetails[ref];
        const categoria: "soloEnDataMapping" | "enCloudWatchOtroMes" = cw
          ? "enCloudWatchOtroMes"
          : "soloEnDataMapping";
        const cwImportMonth = cw?.importMonth;

        let fechaTransaccionOrigen: "cloudWatch" | "updatedAt" | "indeterminado" = "updatedAt";
        if (cw) {
          const cwDay = (cw.fechaTransaccion ?? "").slice(0, 10);
          const ddbDay = (ddb.fechaTransaccionMexico ?? "").slice(0, 10);
          if (cwDay && ddbDay && cwDay === ddbDay) fechaTransaccionOrigen = "cloudWatch";
          else if (cwDay || ddbDay) fechaTransaccionOrigen = "indeterminado";
        }

        onlyInDdbBreakdown.push({
          referencia: ref,
          monto: ddb.monto,
          categoria,
          cwImportMonth: cwImportMonth || undefined,
          fechaTransaccionOrigen,
          ddbFechaTransaccionMexico: ddb.fechaTransaccionMexico,
        });
      }
    }

    return {
      period: { startMonth, endMonth },
      summary: {
        totalCwRecords,
        uniqueCwRefs: byRefCw.size,
        totalDdbRecordsPvMinusDec,
        uniqueDdbRefsPvMinusDec: byRefDdb.size,
        onlyInDdbCount: onlyInDdb.length,
        diferencia,
      },
      onlyInDdbBreakdown,
      duplicateCwRefs,
      duplicateDdbRefs,
      confirmacionPagoValidado:
        "Todas las referencias en onlyInDdb provienen de datamappingRecords con status PAGO VALIDADO y fuente distinta de DEC (PV-DEC), por construcción del filtro por fechaTransaccionMexico.",
    };
  },
});
