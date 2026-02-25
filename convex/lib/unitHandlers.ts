/**
 * Registry of unit execution handlers by jobType.
 * Replaces hardcoded switch in pipelineRunner with configurable dispatch.
 */
import { api } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Tope por ejecución de action para evitar timeout Convex (600s). Salir antes permite retry con continueState. */
const ACTION_TIME_LIMIT_MS = 550_000;

export type UnitHandler = (
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
) => Promise<unknown>;

async function isJobCancelled(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">
): Promise<boolean> {
  const job = await ctx.runQuery(api.pipelineQueries.getPipelineJob, { jobId });
  return job?.status === "cancelled";
}

/** Lanza error con unitResult para que reportPipelineUnitComplete lo guarde (retry con continueState). */
function throwPartialResult(unitResult: Record<string, unknown>): never {
  const err = new Error("Action time limit (550s) reached") as Error & { unitResult?: Record<string, unknown> };
  err.unitResult = unitResult;
  throw err;
}

export async function datamappingFullHistory(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const { ym, startDay, endDay } = payload as { ym: string; startDay: number; endDay: number };
  const [y, m] = ym.split("-").map(Number);
  let inserted = 0;
  let updated = 0;
  let maxUpdatedAt: string | null = null;
  for (let day = startDay; day <= endDay; day++) {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    let exclusiveStartKey: string | undefined;
    let hasMore = true;
    while (hasMore) {
      if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
      const res = (await ctx.runAction(api.actions.fetchDatamappingForDayChunk, {
        year: y,
        month: m,
        day,
        exclusiveStartKey,
      })) as {
        inserted: number;
        updated: number;
        hasMore: boolean;
        exclusiveStartKey: string | null;
        maxUpdatedAt: string | null;
      };
      inserted += res.inserted;
      updated += res.updated;
      if (res.maxUpdatedAt && (!maxUpdatedAt || res.maxUpdatedAt > maxUpdatedAt)) {
        maxUpdatedAt = res.maxUpdatedAt;
      }
      hasMore = res.hasMore;
      exclusiveStartKey = res.exclusiveStartKey ?? undefined;
    }
  }
  return { ym, startDay, endDay, status: "completed" as const, inserted, updated, maxUpdatedAt };
}

export async function datamappingClear(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  _payload: Record<string, unknown>
): Promise<unknown> {
  let totalDeleted = 0;
  while (true) {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    const res = (await ctx.runMutation(api.datamappingMutations.deleteDatamappingRecordsBatch, {})) as {
      deleted: number;
    };
    totalDeleted += res.deleted;
    if (res.deleted === 0) break;
  }
  return { totalDeleted };
}

export async function cloudwatchClear(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const month = payload.month as string | undefined;
  const months = payload.months as string[] | undefined;

  if (month != null) {
    let totalDeleted = 0;
    while (true) {
      if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
      const res = (await ctx.runMutation(api.cloudwatchMutations.deletePaymentsByMonth, {
        month,
      })) as { deleted: number };
      totalDeleted += res.deleted;
      if (res.deleted === 0) break;
    }
    await ctx.runMutation(api.cloudwatchMutations.deleteMonthStats, { month });
    return { month, totalDeleted };
  }

  if (months == null || months.length === 0) {
    throw new Error("Payload debe tener month o months");
  }
  let totalDeleted = 0;
  for (const m of months) {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    while (true) {
      if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
      const res = (await ctx.runMutation(api.cloudwatchMutations.deletePaymentsByMonth, {
        month: m,
      })) as { deleted: number };
      totalDeleted += res.deleted;
      if (res.deleted === 0) break;
    }
    await ctx.runMutation(api.cloudwatchMutations.deleteMonthStats, { month: m });
  }
  await ctx.runMutation(api.cloudwatchMutations.clearCloudwatchWatermark, {});
  return { monthsProcessed: months.length, totalDeleted };
}

/**
 * Enriquecimiento por mes (o rango de días): solo procesa registros con enrichmentExtracted === false.
 * Si el payload tiene startDay/endDay, solo procesa ese rango de días; si no, todo el mes (legacy).
 */
export async function datamappingEnrichmentByMonths(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const ym = payload.ym as string;
  const unitId = (payload.unitId as string) ?? ym;
  const resumeFromDay = payload.resumeFromDay as number | undefined;
  const [y, monthNum] = ym.split("-").map(Number);
  const lastDay = new Date(y, monthNum, 0).getDate();
  const startDayRange = (payload.startDay as number) ?? 1;
  const endDayRange = (payload.endDay as number) ?? lastDay;
  const startTime = Date.now();

  const monthPrecheck = (await ctx.runQuery(
    api.datamappingQueries.hasPendingEnrichmentForMonth,
    { month: ym }
  )) as { hasPending: boolean };
  if (!monthPrecheck.hasPending) {
    return {
      ym,
      ...(startDayRange !== 1 || endDayRange !== lastDay ? { startDay: startDayRange, endDay: endDayRange } : {}),
      status: "completed" as const,
      processed: 0,
      enriched: 0,
      skipped: true,
      reason: "no pending",
    };
  }

  let processed = 0;
  let enriched = 0;

  for (let day = resumeFromDay ?? startDayRange; day <= endDayRange; day++) {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
      throwPartialResult({
        partial: true,
        processed,
        enriched,
        resumeFromDay: day,
        error: "Action time limit (550s) reached",
      });
    }

    const dayPrecheck = (await ctx.runQuery(
      api.datamappingQueries.hasPendingEnrichmentForDay,
      { month: ym, day }
    )) as { hasPending: boolean };
    if (!dayPrecheck.hasPending) continue;

    const dayStr = String(day).padStart(2, "0");
    const fromDate = `${ym}-${dayStr}`;
    const toDate = fromDate;
    let continueState: { cursor: string | null; updatedAtFrom: string; updatedAtTo: string } | undefined =
      day === (resumeFromDay ?? startDayRange) && payload.continueState != null
        ? (payload.continueState as { cursor: string | null; updatedAtFrom: string; updatedAtTo: string })
        : undefined;

    do {
      if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
      if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
        throwPartialResult({
          partial: true,
          processed,
          enriched,
          resumeFromDay: day,
          continueState: continueState ?? undefined,
          error: "Action time limit (550s) reached",
        });
      }
      const result = (await ctx.runAction(api.actions.enrichDatamappingWithRfc, {
        fromDate,
        toDate,
        continueState,
        maxDurationMs: 85_000,
        jobId,
      })) as {
        processed: number;
        enriched: number;
        isDone: boolean;
        cancelled?: boolean;
        continueState?: { cursor: string | null; updatedAtFrom: string; updatedAtTo: string };
      };
      processed += result.processed;
      enriched += result.enriched;
      continueState = result.continueState;

      await ctx.runAction(api.pipelineActions.updatePipelineUnitProgressWithRetry, {
        jobId,
        unitId,
        progressDetail: { processed, enriched },
      });

      if (result.isDone || result.cancelled) break;
    } while (continueState);
  }

  return {
    ym,
    ...(startDayRange !== 1 || endDayRange !== lastDay ? { startDay: startDayRange, endDay: endDayRange } : {}),
    status: "completed" as const,
    processed,
    enriched,
  };
}

export async function datamappingBackfillEnrichmentByMonths(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const fromDate = payload.fromDate as string | undefined;
  const toDate = payload.toDate as string | undefined;

  if (fromDate != null && toDate != null) {
    const updatedAtFrom = `${fromDate}T00:00:00.000Z`;
    const [y, m, d] = toDate.slice(0, 10).split("-").map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
    const updatedAtTo = nextDay.toISOString().replace(/\.\d{3}Z$/, ".000Z");
    let patched = 0;
    let cursor: string | null = null;
    do {
      if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
      const result = (await ctx.runAction(
        api.actions.backfillDatamappingEnrichmentExtractedForRange,
        {
          updatedAtFrom,
          updatedAtTo,
          cursor: cursor ?? undefined,
          maxDurationMs: 85_000,
        }
      )) as { total: number; cursor: string | null; isDone: boolean };
      patched += result.total;
      cursor = result.cursor;
      if (result.isDone) break;
    } while (cursor);
    return { fromDate, toDate, status: "completed" as const, patched };
  }

  const ym = payload.ym as string;
  if (!ym) throw new Error("Payload debe tener ym o fromDate/toDate");
  const updatedAtFrom = `${ym}-01T00:00:00.000Z`;
  const [y, month] = ym.split("-").map(Number);
  const nextMonth =
    month === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, month, 1));
  const updatedAtTo = nextMonth.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  let patched = 0;
  let cursor: string | null = null;
  do {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    const result = (await ctx.runAction(
      api.actions.backfillDatamappingEnrichmentExtractedForRange,
      {
        updatedAtFrom,
        updatedAtTo,
        cursor: cursor ?? undefined,
        maxDurationMs: 85_000,
      }
    )) as { total: number; cursor: string | null; isDone: boolean };
    patched += result.total;
    cursor = result.cursor;
    if (result.isDone) break;
  } while (cursor);
  return { ym, status: "completed" as const, patched };
}

export async function datamappingLoadFromDate(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const unitId = (payload.unitId as string) ?? "load-from-date";
  const fromDate = payload.fromDate as string | undefined;
  const toDate = payload.toDate as string | undefined;
  const sinceDate = (payload.sinceDate as string) ?? fromDate;
  if (!sinceDate) {
    throw new Error("Payload debe tener sinceDate o fromDate");
  }

  let cursor: string | undefined;
  let totalInserted = 0;
  let totalUpdated = 0;
  let pageIndex = 0;
  const byDate: Record<string, number> = {};

  while (true) {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    const r = (await ctx.runAction(api.actions.fetchDatamappingAndIngest, {
      sinceDate,
      toDate,
      exclusiveStartKey: cursor,
    })) as {
      inserted: number;
      updated: number;
      hasMore: boolean;
      lastEvaluatedKey?: string;
      byDate?: Record<string, number>;
    };
    totalInserted += r.inserted;
    totalUpdated += r.updated;
    if (r.byDate) {
      for (const [d, count] of Object.entries(r.byDate)) {
        byDate[d] = (byDate[d] ?? 0) + count;
      }
    }
    pageIndex += 1;

    await ctx.runAction(api.pipelineActions.updatePipelineUnitProgressWithRetry, {
      jobId,
      unitId,
      progressDetail: { processed: totalInserted + totalUpdated, updated: totalUpdated },
    });

    if (!r.hasMore) break;
    cursor = r.lastEvaluatedKey;
  }

  if (fromDate != null && toDate != null) {
    return {
      fromDate,
      toDate,
      pages: pageIndex,
      inserted: totalInserted,
      updated: totalUpdated,
      byDate: Object.keys(byDate).length > 0 ? byDate : undefined,
    };
  }
  return {
    sinceDate,
    pages: pageIndex,
    inserted: totalInserted,
    updated: totalUpdated,
    byDate: Object.keys(byDate).length > 0 ? byDate : undefined,
  };
}

export async function datamappingFechaTransaccionFull(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const fromDate = payload.fromDate as string | undefined;
  const toDate = payload.toDate as string | undefined;
  const unitId = (payload.unitId as string) ?? (payload.ym as string);

  if (fromDate != null && toDate != null) {
    return runFechaTransaccionChunk(ctx, jobId, payload);
  }

  const ym = payload.ym as string;
  if (!ym) throw new Error("Payload debe tener ym o fromDate/toDate");
  const [y, m] = ym.split("-").map(Number);
  const startTime = Date.now();
  let processed = 0;
  let updated = 0;
  let continueState: { cursor: string | null } | undefined = payload.continueState as
    | { cursor: string | null }
    | undefined;
  do {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
      throwPartialResult({
        partial: true,
        continueState: continueState ?? null,
        processed,
        updated,
        error: "Action time limit (550s) reached",
      });
    }
    const result = (await ctx.runAction(api.actions.backfillFechaTransaccionForMonth, {
      year: y,
      month: m,
      continueState,
      maxDurationMs: 85_000,
      jobId,
    })) as {
      processed: number;
      updated: number;
      isDone: boolean;
      continueState?: { cursor: string | null };
    };
    processed += result.processed;
    updated += result.updated;
    continueState = result.continueState;

    await ctx.runAction(api.pipelineActions.updatePipelineUnitProgressWithRetry, {
      jobId,
      unitId: ym,
      progressDetail: { processed, updated },
    });

    if (result.isDone) break;
  } while (continueState);
  return { ym, status: "completed" as const, processed, updated };
}

/** Lógica compartida para un bloque de 3 días (full y from_date). */
async function runFechaTransaccionChunk(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const fromDate = payload.fromDate as string;
  const toDate = payload.toDate as string;
  const unitId = (payload.unitId as string) ?? "fecha-transaccion-chunk";
  let totalProcessed = 0;
  let totalUpdated = 0;
  let continueState: { cursor: string | null } | undefined = payload.continueState as
    | { cursor: string | null }
    | undefined;
  const startTime = Date.now();

  do {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
      throwPartialResult({
        partial: true,
        continueState: continueState ?? null,
        processed: totalProcessed,
        updated: totalUpdated,
        error: "Action time limit (550s) reached",
      });
    }
    const result = (await ctx.runAction(api.actions.backfillFechaTransaccionForDatamapping, {
      sinceDate: fromDate,
      toDate,
      continueState,
      maxDurationMs: 85_000,
      jobId,
    })) as {
      processed: number;
      updated: number;
      isDone: boolean;
      continueState?: { cursor: string | null };
    };
    totalProcessed += result.processed;
    totalUpdated += result.updated;
    continueState = result.continueState;

    await ctx.runAction(api.pipelineActions.updatePipelineUnitProgressWithRetry, {
      jobId,
      unitId,
      progressDetail: { processed: totalProcessed, updated: totalUpdated },
    });

    if (result.isDone) break;
  } while (continueState);

  return { fromDate, toDate, processed: totalProcessed, updated: totalUpdated };
}

export async function datamappingFechaTransaccionFromDate(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const unitId = (payload.unitId as string) ?? "fecha-transaccion-from-date";
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalUpdated = 0;
  let continueState: { cursor: string | null } | undefined = payload.continueState as
    | { cursor: string | null }
    | undefined;

  const fromDate = payload.fromDate as string | undefined;
  const toDate = payload.toDate as string | undefined;
  const sinceDate = (payload.sinceDate as string) ?? fromDate;
  if (!sinceDate) {
    throw new Error("Payload debe tener sinceDate o fromDate");
  }

  do {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
      throwPartialResult({
        partial: true,
        continueState: continueState ?? null,
        processed: totalProcessed,
        updated: totalUpdated,
        error: "Action time limit (550s) reached",
      });
    }
    const result = (await ctx.runAction(api.actions.backfillFechaTransaccionForDatamapping, {
      sinceDate,
      toDate,
      continueState,
      maxDurationMs: 85_000,
      jobId,
    })) as {
      processed: number;
      updated: number;
      isDone: boolean;
      continueState?: { cursor: string | null };
    };
    totalProcessed += result.processed;
    totalUpdated += result.updated;
    continueState = result.continueState;

    await ctx.runAction(api.pipelineActions.updatePipelineUnitProgressWithRetry, {
      jobId,
      unitId,
      progressDetail: { processed: totalProcessed, updated: totalUpdated },
    });

    if (result.isDone) break;
  } while (continueState);

  if (fromDate != null && toDate != null) {
    return { fromDate, toDate, processed: totalProcessed, updated: totalUpdated };
  }
  return { sinceDate, processed: totalProcessed, updated: totalUpdated };
}

export async function datamappingIncremental(
  ctx: ActionCtx,
  _jobId: Id<"pipelineJobs">,
  _payload: Record<string, unknown>
): Promise<unknown> {
  return await ctx.runAction(api.actions.fetchDatamappingIncremental, {});
}

/**
 * Sincroniza un solo día por chunks (fetchDatamappingForDayChunk en bucle).
 * Estandarizado para evitar timeouts ~5 min en días con mucho volumen.
 * Usado por datamappingSyncByRange y datamappingSyncByMonths.
 * En error lanza con partial: { inserted, updated, chunkCount, durationMs } para diagnóstico.
 */
async function syncOneDayWithChunks(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  y: number,
  m: number,
  d: number
): Promise<{ inserted: number; updated: number; chunkCount: number; durationMs: number }> {
  const startedAt = Date.now();
  let inserted = 0;
  let updated = 0;
  let chunkCount = 0;
  let exclusiveStartKey: string | undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
      const res = (await ctx.runAction(api.actions.fetchDatamappingForDayChunk, {
        year: y,
        month: m,
        day: d,
        exclusiveStartKey,
      })) as {
        inserted: number;
        updated: number;
        hasMore: boolean;
        exclusiveStartKey: string | null;
        maxUpdatedAt: string | null;
      };
      inserted += res.inserted;
      updated += res.updated;
      chunkCount += 1;
      hasMore = res.hasMore;
      exclusiveStartKey = res.exclusiveStartKey ?? undefined;
    }
    return {
      inserted,
      updated,
      chunkCount,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const e = err as Error & { partial?: { inserted: number; updated: number; chunkCount: number; durationMs: number } };
    e.partial = { inserted, updated, chunkCount, durationMs: Date.now() - startedAt };
    throw err;
  }
}

/**
 * Sincroniza un mes (o rango de días dentro del mes) procesando día a día por chunks.
 * Si el payload tiene startDay/endDay, solo procesa ese rango; si no, todo el mes (legacy).
 */
export async function datamappingSyncByMonths(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const ym = payload.ym as string;
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startDay = (payload.startDay as number) ?? 1;
  const endDay = (payload.endDay as number) ?? lastDay;
  const startedAt = Date.now();
  let inserted = 0;
  let updated = 0;
  let chunkCount = 0;

  try {
    for (let day = startDay; day <= endDay; day++) {
      if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
      const dayResult = await syncOneDayWithChunks(ctx, jobId, y, m, day);
      inserted += dayResult.inserted;
      updated += dayResult.updated;
      chunkCount += dayResult.chunkCount;
    }
    return {
      ym,
      ...(startDay !== 1 || endDay !== lastDay ? { startDay, endDay } : {}),
      inserted,
      updated,
      chunkCount,
      durationMs: Date.now() - startedAt,
      status: "completed" as const,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errWithResult = new Error(errorMessage) as Error & { unitResult?: Record<string, unknown> };
    errWithResult.unitResult = {
      ym,
      ...(startDay !== 1 || endDay !== lastDay ? { startDay, endDay } : {}),
      error: errorMessage,
      inserted,
      updated,
      chunkCount,
      durationMs,
    };
    throw errWithResult;
  }
}

/**
 * Sincroniza un día usando chunks (mismo proceso que sync por meses).
 * Evita timeouts ~5 min en días con mucho volumen (ej. 2024-05-04).
 */
export async function datamappingSyncByRange(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const date = payload.date as string;
  const [y, m, d] = date.split("-").map(Number);

  try {
    const result = await syncOneDayWithChunks(ctx, jobId, y, m, d);
    return {
      date,
      inserted: result.inserted,
      updated: result.updated,
      chunkCount: result.chunkCount,
      durationMs: result.durationMs,
      status: "completed" as const,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const partial = (err as { partial?: { inserted: number; updated: number; chunkCount: number; durationMs: number } }).partial;
    const errWithResult = new Error(errorMessage) as Error & { unitResult?: Record<string, unknown> };
    errWithResult.unitResult = {
      date,
      error: errorMessage,
      inserted: partial?.inserted ?? 0,
      updated: partial?.updated ?? 0,
      chunkCount: partial?.chunkCount ?? 0,
      durationMs: partial?.durationMs ?? 0,
    };
    throw errWithResult;
  }
}

export async function cloudwatchIncremental(
  ctx: ActionCtx,
  _jobId: Id<"pipelineJobs">,
  _payload: Record<string, unknown>
): Promise<unknown> {
  return await ctx.runAction(api.actions.fetchCloudwatchIncremental, {});
}

export async function cloudwatchSyncByMonths(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const ym = payload.ym as string;
  const startDay = payload.startDay as number;
  const endDay = payload.endDay as number;
  let inserted = 0;
  let deleted = 0;
  const failedDays: string[] = [];
  let lastProcessedDate: string | null = null;
  for (let day = startDay; day <= endDay; day++) {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    const date = `${ym}-${String(day).padStart(2, "0")}`;
    try {
      const res = (await ctx.runAction(api.actions.fetchAndIngestForDate, {
        date,
        skipMonthStatsUpdate: true,
      })) as { inserted: number; deleted: number; date: string };
      inserted += res.inserted;
      deleted += res.deleted;
      lastProcessedDate = date;
    } catch {
      failedDays.push(date);
    }
  }
  return {
    ym,
    startDay,
    endDay,
    inserted,
    deleted,
    lastProcessedDate,
    ...(failedDays.length > 0 ? { failedDays } : {}),
    status: "completed" as const,
  };
}

export async function cloudwatchSyncByRange(
  ctx: ActionCtx,
  _jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const date = payload.date as string;
  const res = (await ctx.runAction(api.actions.fetchAndIngestForDate, {
    date,
    skipMonthStatsUpdate: true,
  })) as {
    inserted: number;
    deleted: number;
    date: string;
    audit?: {
      rawBySource: { v1: number; v2: number; payment: number };
      parsedBySource: { v1: number; v2: number; payment: number };
      refsKeptBySource: { v1: number; v2: number; payment: number };
      refsDiscardedBySource: { v1: number; v2: number; payment: number };
      truncationRisk: boolean;
    };
  };
  return {
    date,
    inserted: res.inserted,
    deleted: res.deleted,
    status: "completed" as const,
    ...(res.audit && {
      rawBySource: res.audit.rawBySource,
      parsedBySource: res.audit.parsedBySource,
      refsKeptBySource: res.audit.refsKeptBySource,
      truncationRisk: res.audit.truncationRisk,
    }),
  };
}

/** Sincronización determinística: una fecha, conteo por hora + extracción por intervalos + tablas fuente + verificación. */
export async function cloudwatchDeterministicSyncByRange(
  ctx: ActionCtx,
  _jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const date = payload.date as string;
  const res = (await ctx.runAction(api.actions.runDeterministicSyncForDate, {
    date,
  })) as { date: string; bySource: Record<string, { expected: number; inserted: number }>; ok: boolean };
  return {
    date: res.date,
    bySource: res.bySource,
    ok: res.ok,
    status: "completed" as const,
  };
}

/** Sincronización determinística por meses: por cada día del rango, runDeterministicSyncForDate. */
export async function cloudwatchDeterministicSyncByMonths(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">,
  payload: Record<string, unknown>
): Promise<unknown> {
  const ym = payload.ym as string;
  const startDay = payload.startDay as number;
  const endDay = payload.endDay as number;
  const startTime = Date.now();
  const byDay: Record<string, { bySource: Record<string, { expected: number; inserted: number }> }> = {};
  let totalInserted = 0;

  for (let d = startDay; d <= endDay; d++) {
    if (await isJobCancelled(ctx, jobId)) throw new Error("Job cancelled");
    if (Date.now() - startTime > ACTION_TIME_LIMIT_MS) {
      throwPartialResult({
        partial: true,
        ym,
        startDay,
        endDay,
        lastCompletedDay: d - 1,
        byDay,
        totalInserted,
        error: "Action time limit (550s) reached",
      });
    }
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    try {
      const res = (await ctx.runAction(api.actions.runDeterministicSyncForDate, {
        date,
      })) as { date: string; bySource: Record<string, { expected: number; inserted: number }>; ok: boolean };
      byDay[date] = { bySource: res.bySource };
      const dayInserted = Object.values(res.bySource).reduce((s, x) => s + x.inserted, 0);
      totalInserted += dayInserted;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const unitResult =
        err && typeof (err as { unitResult?: unknown }).unitResult === "object"
          ? (err as { unitResult: Record<string, unknown> }).unitResult
          : undefined;
      const errWithResult = new Error(errorMessage) as Error & { unitResult?: Record<string, unknown> };
      errWithResult.unitResult = {
        date,
        ym,
        startDay,
        endDay,
        byDay,
        totalInserted,
        error: errorMessage,
        ...unitResult,
      };
      throw errWithResult;
    }
  }

  return {
    ym,
    startDay,
    endDay,
    byDay,
    totalInserted,
    status: "completed" as const,
  };
}

/** Registry: jobType -> handler. Enables dynamic dispatch and future registration without editing runner. */
export const UNIT_HANDLERS: Record<string, UnitHandler> = {
  datamapping_full_history: datamappingFullHistory,
  datamapping_clear: datamappingClear,
  cloudwatch_clear: cloudwatchClear,
  datamapping_enrichment_by_months: datamappingEnrichmentByMonths,
  datamapping_backfill_enrichment_by_months: datamappingBackfillEnrichmentByMonths,
  datamapping_load_from_date: datamappingLoadFromDate,
  datamapping_fecha_transaccion_full: datamappingFechaTransaccionFull,
  datamapping_fecha_transaccion_from_date: datamappingFechaTransaccionFromDate,
  datamapping_incremental: datamappingIncremental,
  datamapping_sync_by_months: datamappingSyncByMonths,
  datamapping_sync_by_range: datamappingSyncByRange,
  cloudwatch_incremental: cloudwatchIncremental,
  cloudwatch_sync_by_months: cloudwatchSyncByMonths,
  cloudwatch_sync_by_range: cloudwatchSyncByRange,
  cloudwatch_deterministic_sync_by_months: cloudwatchDeterministicSyncByMonths,
  cloudwatch_deterministic_sync_by_range: cloudwatchDeterministicSyncByRange,
};

export function getUnitHandler(jobType: string): UnitHandler | undefined {
  return UNIT_HANDLERS[jobType];
}
