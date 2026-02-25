import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const scopeValidator = v.any();
const progressValidator = v.optional(
  v.object({
    current: v.number(),
    total: v.optional(v.number()),
    unit: v.optional(v.string()),
    message: v.optional(v.string()),
  })
);

/** Crea un job de pipeline con status "pending". */
export const createPipelineJob = mutation({
  args: {
    jobType: v.string(),
    scope: scopeValidator,
    parentJobId: v.optional(v.id("pipelineJobs")),
    dependsOnJobIds: v.optional(v.array(v.id("pipelineJobs"))),
    externalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pipelineJobs", {
      jobType: args.jobType,
      scope: args.scope,
      status: "pending",
      startedAt: Date.now(),
      ...(args.parentJobId != null && { parentJobId: args.parentJobId }),
      ...(args.dependsOnJobIds != null && {
        dependsOnJobIds: args.dependsOnJobIds,
      }),
      ...(args.externalId != null && { externalId: args.externalId }),
    });
  },
});

/** Actualiza progreso y opcionalmente status del job. */
export const updatePipelineJobProgress = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    progress: v.optional(progressValidator),
  },
  handler: async (ctx, { jobId, status, progress }) => {
    const doc = await ctx.db.get(jobId);
    if (!doc) return;
    const updates: Record<string, unknown> = {};
    if (status != null) updates.status = status;
    if (progress != null) updates.progress = progress;
    await ctx.db.patch(jobId, updates);
  },
});

/** Marca el job como completado con resultado. */
export const updatePipelineJobResult = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    result: v.any(),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, result, completedAt }) => {
    const doc = await ctx.db.get(jobId);
    if (!doc) return;
    await ctx.db.insert("auditEvents", {
      jobId,
      eventType: "run.completed",
      stepKey: doc.jobType,
      timestamp: completedAt ?? Date.now(),
      resultSummary:
        typeof result === "object" && result !== null ? { keys: Object.keys(result as object) } : undefined,
    });
    await ctx.db.patch(jobId, {
      status: "completed",
      result,
      completedAt: completedAt ?? Date.now(),
    });
  },
});

/** Marca el job como fallido con mensaje de error. */
export const updatePipelineJobError = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    errorMessage: v.string(),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, errorMessage, completedAt }) => {
    const doc = await ctx.db.get(jobId);
    if (!doc) return;
    await ctx.db.insert("auditEvents", {
      jobId,
      eventType: "run.failed",
      stepKey: doc.jobType,
      timestamp: completedAt ?? Date.now(),
      errorCategory: "job_error",
      resultSummary: { errorMessage: errorMessage.slice(0, 500) },
    });
    await ctx.db.patch(jobId, {
      status: "failed",
      errorMessage,
      completedAt: completedAt ?? Date.now(),
    });
  },
});

/** Incrementa retryCount del job (para Inngest reintentos). */
export const updatePipelineJobRetry = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    retryCount: v.number(),
  },
  handler: async (ctx, { jobId, retryCount }) => {
    const doc = await ctx.db.get(jobId);
    if (!doc) return;
    await ctx.db.patch(jobId, { retryCount });
  },
});

const DAYS_PER_UNIT = 3;

/** Marca una unidad como running (llamado desde processPipelineUnit). */
export const markPipelineUnitRunning = mutation({
  args: { unitId: v.id("pipelineJobUnits") },
  handler: async (ctx, { unitId }) => {
    await ctx.db.patch(unitId, { status: "running", startedAt: Date.now() });
  },
});

const progressDetailValidator = v.object({
  processed: v.number(),
  enriched: v.optional(v.number()),
  updated: v.optional(v.number()),
});

/** Actualiza progreso parcial de una unidad en running (ej. enriquecimiento: processed/enriched). */
export const updatePipelineUnitProgress = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    unitId: v.string(),
    progressDetail: progressDetailValidator,
  },
  handler: async (ctx, { jobId, unitId, progressDetail }) => {
    const units = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
    const unit = units.find((u) => u.unitId === unitId);
    if (!unit || unit.status !== "running") return;
    await ctx.db.patch(unit._id, { progressDetail });
  },
});

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

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Genera fechas YYYY-MM-DD desde startDate hasta endDate (inclusive). Iteración por días calendario sin depender de zona horaria. */
function generateDateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let [y, m, d] = startDate.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = endDate.slice(0, 10).split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = (year: number, month: number) =>
    new Date(year, month, 0).getDate();
  while (y < ey || (y === ey && m < em) || (y === ey && m === em && d <= ed)) {
    out.push(`${y}-${pad(m)}-${pad(d)}`);
    if (y === ey && m === em && d === ed) break;
    d += 1;
    if (d > daysInMonth(y, m)) {
      d = 1;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return out;
}

const DAYS_PER_CHUNK_FECHA_TRANSACCION_FROM_DATE = 3;

/** Genera bloques de 3 días desde sinceDate hasta endDate (inclusive). endDate por defecto: hoy. */
function generateThreeDayChunks(
  sinceDate: string,
  endDate?: string
): { fromDate: string; toDate: string }[] {
  const end = endDate ?? new Date().toISOString().slice(0, 10);
  const dates = generateDateRange(sinceDate.slice(0, 10), end);
  const chunks: { fromDate: string; toDate: string }[] = [];
  for (let i = 0; i < dates.length; i += DAYS_PER_CHUNK_FECHA_TRANSACCION_FROM_DATE) {
    const fromDate = dates[i]!;
    const toDate = dates[Math.min(i + DAYS_PER_CHUNK_FECHA_TRANSACCION_FROM_DATE - 1, dates.length - 1)]!;
    chunks.push({ fromDate, toDate });
  }
  return chunks;
}

/** Genera bloques de 3 días por cada mes en la lista (para fecha_transaccion_full). */
function generateThreeDayChunksForMonths(months: string[]): { fromDate: string; toDate: string }[] {
  const chunks: { fromDate: string; toDate: string }[] = [];
  for (const ym of months) {
    const [y, m] = ym.split("-").map(Number);
    const lastDay = getDaysInMonth(y, m);
    const fromDate = `${ym}-${String(1).padStart(2, "0")}`;
    const toDate = `${ym}-${String(lastDay).padStart(2, "0")}`;
    chunks.push(...generateThreeDayChunks(fromDate, toDate));
  }
  return chunks;
}

type UnitSpec = { unitId: string; payload: unknown; sortOrder: number };

function generateUnitsForJobType(
  jobType: string,
  scope: Record<string, unknown>
): UnitSpec[] {
  switch (jobType) {
    case "datamapping_full_history": {
      const months = (scope.months as string[]) ?? generateMonthRange("2024-01", "2026-02");
      const units: UnitSpec[] = [];
      let sortOrder = 0;
      for (const ym of months) {
        const [y, m] = ym.split("-").map(Number);
        const lastDay = getDaysInMonth(y, m);
        for (let start = 1; start <= lastDay; start += DAYS_PER_UNIT) {
          const end = Math.min(start + DAYS_PER_UNIT - 1, lastDay);
          units.push({
            unitId: `${ym}-dias-${start}-${end}`,
            payload: { ym, startDay: start, endDay: end },
            sortOrder: sortOrder++,
          });
        }
      }
      return units;
    }
    case "datamapping_clear":
      return [{ unitId: "clear-all", payload: {}, sortOrder: 0 }];
    case "datamapping_enrichment_by_months": {
      const months =
        (scope.months as string[]) ?? generateMonthRange("2024-01", "2026-02");
      const units: UnitSpec[] = [];
      let sortOrder = 0;
      for (const ym of months) {
        const [y, m] = ym.split("-").map(Number);
        const lastDay = getDaysInMonth(y, m);
        for (let start = 1; start <= lastDay; start += DAYS_PER_UNIT) {
          const end = Math.min(start + DAYS_PER_UNIT - 1, lastDay);
          const unitId = `${ym}-dias-${start}-${end}`;
          units.push({
            unitId,
            payload: { ym, startDay: start, endDay: end, unitId },
            sortOrder: sortOrder++,
          });
        }
      }
      return units;
    }
    case "datamapping_backfill_enrichment_by_months": {
      const months =
        (scope.months as string[]) ?? generateMonthRange("2024-01", "2026-02");
      const chunks = generateThreeDayChunksForMonths(months);
      if (chunks.length === 0) return [];
      return chunks.map((chunk, i) => {
        const unitId = `backfill-enrichment-${chunk.fromDate}-${chunk.toDate}`;
        return {
          unitId,
          payload: { fromDate: chunk.fromDate, toDate: chunk.toDate, unitId },
          sortOrder: i,
        };
      });
    }
    case "datamapping_load_from_date": {
      const sinceDate = scope.sinceDate as string;
      const toDate = scope.toDate as string | undefined;
      const chunks = generateThreeDayChunks(sinceDate, toDate);
      if (chunks.length === 0) return [];
      return chunks.map((chunk, i) => {
        const unitId = `load-from-date-${chunk.fromDate}-${chunk.toDate}`;
        return {
          unitId,
          payload: { fromDate: chunk.fromDate, toDate: chunk.toDate, unitId },
          sortOrder: i,
        };
      });
    }
    case "datamapping_fecha_transaccion_full": {
      const startDate = scope.startDate as string | undefined;
      const endDate = scope.endDate as string | undefined;
      const chunks =
        startDate != null && endDate != null && startDate.length >= 10 && endDate.length >= 10
          ? generateThreeDayChunks(startDate.slice(0, 10), endDate.slice(0, 10))
          : generateThreeDayChunksForMonths(
              (scope.months as string[]) ?? generateMonthRange("2024-01", "2026-02")
            );
      if (chunks.length === 0) return [];
      return chunks.map((chunk, i) => {
        const unitId = `fecha-transaccion-full-${chunk.fromDate}-${chunk.toDate}`;
        return {
          unitId,
          payload: { fromDate: chunk.fromDate, toDate: chunk.toDate, unitId },
          sortOrder: i,
        };
      });
    }
    case "datamapping_fecha_transaccion_from_date": {
      const sinceDate = scope.sinceDate as string;
      const toDate = scope.toDate as string | undefined;
      const chunks = generateThreeDayChunks(sinceDate, toDate);
      if (chunks.length === 0) return [];
      return chunks.map((chunk, i) => {
        const unitId = `fecha-transaccion-from-date-${chunk.fromDate}-${chunk.toDate}`;
        return {
          unitId,
          payload: { fromDate: chunk.fromDate, toDate: chunk.toDate, unitId },
          sortOrder: i,
        };
      });
    }
    case "datamapping_incremental":
      return [{ unitId: "incremental", payload: {}, sortOrder: 0 }];
    case "datamapping_sync_by_months": {
      const months =
        (scope.months as string[]) ?? generateMonthRange("2024-01", "2026-02");
      const units: UnitSpec[] = [];
      let sortOrder = 0;
      for (const ym of months) {
        const [y, m] = ym.split("-").map(Number);
        const lastDay = getDaysInMonth(y, m);
        for (let start = 1; start <= lastDay; start += DAYS_PER_UNIT) {
          const end = Math.min(start + DAYS_PER_UNIT - 1, lastDay);
          units.push({
            unitId: `${ym}-dias-${start}-${end}`,
            payload: { ym, startDay: start, endDay: end },
            sortOrder: sortOrder++,
          });
        }
      }
      return units;
    }
    case "datamapping_sync_by_range": {
      const startDate = scope.startDate as string;
      const endDate = scope.endDate as string;
      if (!startDate || !endDate || startDate > endDate) return [];
      const dates = generateDateRange(startDate, endDate);
      return dates.map((date, i) => ({
        unitId: date,
        payload: { date },
        sortOrder: i,
      }));
    }
    case "cloudwatch_sync_by_months": {
      const months = (scope.months as string[]) ?? [];
      if (months.length === 0) return [];
      const units: UnitSpec[] = [];
      let sortOrder = 0;
      for (const ym of months) {
        const [y, m] = ym.split("-").map(Number);
        const lastDay = getDaysInMonth(y, m);
        for (let start = 1; start <= lastDay; start += DAYS_PER_UNIT) {
          const end = Math.min(start + DAYS_PER_UNIT - 1, lastDay);
          units.push({
            unitId: `${ym}-dias-${start}-${end}`,
            payload: { ym, startDay: start, endDay: end },
            sortOrder: sortOrder++,
          });
        }
      }
      return units;
    }
    case "cloudwatch_sync_by_range": {
      const startDate = scope.startDate as string;
      const endDate = scope.endDate as string;
      if (!startDate || !endDate || startDate > endDate) return [];
      const dates = generateDateRange(startDate, endDate);
      return dates.map((date, i) => ({
        unitId: date,
        payload: { date },
        sortOrder: i,
      }));
    }
    case "cloudwatch_incremental":
      return [{ unitId: "incremental", payload: {}, sortOrder: 0 }];
    case "cloudwatch_clear": {
      const months = (scope.months as string[]) ?? [];
      if (months.length === 0) return [];
      return months.map((month, i) => ({
        unitId: `cloudwatch-clear-${month}`,
        payload: { month },
        sortOrder: i,
      }));
    }
    case "cloudwatch_deterministic_sync_by_months": {
      const months = (scope.months as string[]) ?? [];
      if (months.length === 0) return [];
      const units: UnitSpec[] = [];
      let sortOrder = 0;
      for (const ym of months) {
        const [y, m] = ym.split("-").map(Number);
        const lastDay = getDaysInMonth(y, m);
        for (let start = 1; start <= lastDay; start += DAYS_PER_UNIT) {
          const end = Math.min(start + DAYS_PER_UNIT - 1, lastDay);
          units.push({
            unitId: `det-${ym}-dias-${start}-${end}`,
            payload: { ym, startDay: start, endDay: end },
            sortOrder: sortOrder++,
          });
        }
      }
      return units;
    }
    case "cloudwatch_deterministic_sync_by_range": {
      const startDate = scope.startDate as string;
      const endDate = scope.endDate as string;
      if (!startDate || !endDate || startDate > endDate) return [];
      const dates = generateDateRange(startDate, endDate);
      return dates.map((date, i) => ({
        unitId: `det-${date}`,
        payload: { date },
        sortOrder: i,
      }));
    }
    default:
      return [];
  }
}

/** Job types that run units in parallel (pool de workers). */
const PARALLEL_JOB_TYPES = new Set([
  "cloudwatch_sync_by_months",
  "cloudwatch_sync_by_range",
  "cloudwatch_deterministic_sync_by_months",
  "cloudwatch_deterministic_sync_by_range",
  "datamapping_sync_by_months",
  "datamapping_sync_by_range",
  "datamapping_full_history",
  "datamapping_enrichment_by_months",
  "datamapping_backfill_enrichment_by_months",
  "datamapping_fecha_transaccion_full",
  "datamapping_fecha_transaccion_from_date",
  "datamapping_load_from_date",
  "cloudwatch_clear",
]);

/** Máximo de unidades ejecutándose a la vez (default). Evita OCC en pipelineJobs al reportar muchas completadas simultáneas. */
const PARALLEL_CONCURRENCY_LIMIT = 10;
/** Sync CloudWatch: 1 unidad a la vez. AWS Logs Insights hace throttling con varias consultas simultáneas; con concurrencia 1 el proceso es confiable sin depender de cuántos días seleccione el usuario. */
const CLOUDWATCH_SYNC_CONCURRENCY = 1;
/** Unidades en "running" más de este tiempo se consideran atascadas (ms). */
const STUCK_THRESHOLD_MS = 30 * 60 * 1000;

function getConcurrencyLimit(job: { jobType?: string; maxConcurrency?: number }): number {
  const n = job.maxConcurrency;
  if (n != null && n >= 1) return Math.min(n, 32);
  if (
    job.jobType === "cloudwatch_sync_by_range" ||
    job.jobType === "cloudwatch_sync_by_months" ||
    job.jobType === "cloudwatch_deterministic_sync_by_range" ||
    job.jobType === "cloudwatch_deterministic_sync_by_months"
  ) {
    return CLOUDWATCH_SYNC_CONCURRENCY;
  }
  return PARALLEL_CONCURRENCY_LIMIT;
}

/** Inicia el pipeline: genera unidades, las inserta, marca running y programa la primera (o las primeras N en paralelo).
 *  Dependencias reales: si el job tiene dependsOnJobIds, solo arranca cuando todos estén completed. */
export const startPipelineJob = mutation({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "pending") return;

    const depIds = job.dependsOnJobIds ?? [];
    if (depIds.length > 0) {
      for (const depId of depIds) {
        const dep = await ctx.db.get(depId);
        if (!dep || dep.status !== "completed") return;
      }
    }

    const units = generateUnitsForJobType(job.jobType, job.scope as Record<string, unknown>);
    if (units.length === 0) return;

    for (const u of units) {
      await ctx.db.insert("pipelineJobUnits", {
        jobId,
        unitId: u.unitId,
        payload: u.payload,
        status: "pending",
        sortOrder: u.sortOrder,
      });
    }

    await ctx.db.patch(jobId, {
      status: "running",
      progress: {
        current: 0,
        total: units.length,
        unit: "units",
        message: `Procesando ${units.length} unidades...`,
      },
    });

    await ctx.db.insert("auditEvents", {
      jobId,
      eventType: "run.started",
      stepKey: job.jobType,
      timestamp: Date.now(),
      payloadSummary: { scopeKeys: Object.keys(job.scope ?? {}), unitCount: units.length },
    });

    if (PARALLEL_JOB_TYPES.has(job.jobType)) {
      const limit = getConcurrencyLimit(job);
      const toSchedule = Math.min(limit, units.length);
      for (let i = 0; i < toSchedule; i++) {
        await ctx.scheduler.runAfter(i * 300, api.pipelineActions.processPipelineUnit, {
          jobId,
          unitId: units[i].unitId,
        });
      }
    } else {
      const first = units.reduce((a, b) => (a.sortOrder < b.sortOrder ? a : b));
      await ctx.scheduler.runAfter(0, api.pipelineActions.processPipelineUnit, {
        jobId,
        unitId: first.unitId,
      });
    }
  },
});

/** Marca unidad completada, actualiza progreso, programa siguiente o finaliza. Idempotente: si la unidad ya está completed/failed, no hace nada (permite retry desde la action). */
export const reportPipelineUnitComplete = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    unitId: v.string(),
    result: v.any(),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, { jobId, unitId, result, failed }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;

    const units = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();

    const unit = units.find((u) => u.unitId === unitId);
    if (!unit) return;
    if (unit.status === "completed" || unit.status === "failed") return;

    await ctx.db.patch(unit._id, {
      status: failed ? "failed" : "completed",
      result,
    });

    const progress = job.progress ?? { current: 0, total: units.length };
    const newCurrent = progress.current + 1;
    await ctx.db.patch(jobId, {
      progress: { ...progress, current: newCurrent },
    });

    const resultObj = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
    const resultSummary =
      resultObj === null
        ? undefined
        : {
            keys: Object.keys(resultObj),
            hasError: "error" in resultObj,
            ...((job.jobType === "datamapping_sync_by_range" || job.jobType === "datamapping_sync_by_months") &&
            (resultObj.durationMs != null ||
              resultObj.batchCount != null ||
              resultObj.chunkCount != null ||
              resultObj.inserted != null ||
              resultObj.updated != null ||
              resultObj.error != null)
              ? {
                  diagnostic: {
                    durationMs: resultObj.durationMs,
                    batchCount: resultObj.batchCount ?? resultObj.chunkCount,
                    chunkCount: resultObj.chunkCount,
                    inserted: resultObj.inserted,
                    updated: resultObj.updated,
                    ...(resultObj.ym != null ? { ym: resultObj.ym } : {}),
                    ...(resultObj.error != null ? { error: String(resultObj.error).slice(0, 500) } : {}),
                  },
                }
              : {}),
          };
    await ctx.db.insert("auditEvents", {
      jobId,
      eventType: failed ? "unit.failed" : "unit.completed",
      stepKey: job.jobType,
      unitKey: unitId,
      timestamp: Date.now(),
      resultSummary,
      errorCategory: failed && resultObj !== null && "error" in resultObj ? "unit_error" : undefined,
    });

    if (job.status === "cancelled") return;

    if (!PARALLEL_JOB_TYPES.has(job.jobType)) {
      const pending = units.filter((u) => u.status === "pending");
      if (pending.length > 0) {
        const next = pending.reduce((a, b) =>
          a.sortOrder < b.sortOrder ? a : b
        );
        await ctx.scheduler.runAfter(0, api.pipelineActions.processPipelineUnit, {
          jobId,
          unitId: next.unitId,
        });
        return;
      }
    } else {
      const unitsAfter = await ctx.db
        .query("pipelineJobUnits")
        .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
        .collect();
      const runningCount = unitsAfter.filter((u) => u.status === "running").length;
      const doneCount = unitsAfter.filter(
        (u) => u.status === "completed" || u.status === "failed"
      ).length;
      if (doneCount < unitsAfter.length) {
        const pending = unitsAfter.filter((u) => u.status === "pending");
        const limit = getConcurrencyLimit(job);
        const toSchedule = Math.min(limit - runningCount, pending.length);
        const nextByOrder = [...pending].sort((a, b) => a.sortOrder - b.sortOrder);
        for (let i = 0; i < toSchedule; i++) {
          await ctx.scheduler.runAfter(i * 300, api.pipelineActions.processPipelineUnit, {
            jobId,
            unitId: nextByOrder[i].unitId,
          });
        }
        return;
      }
    }

    const unitsForFinalize = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
    await runFinalize(ctx, jobId, job.jobType, job.scope as Record<string, unknown>, unitsForFinalize);
  },
});

/** Recupera unidades atascadas (running > STUCK_THRESHOLD_MS): las marca failed y programa siguiente o finaliza. */
export const recoverStuckPipelineUnits = mutation({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running") return;

    const units = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();

    const now = Date.now();
    const stuck = units.filter(
      (u) =>
        u.status === "running" &&
        u.startedAt != null &&
        now - u.startedAt > STUCK_THRESHOLD_MS
    );
    if (stuck.length === 0) return;

    const stuckError = {
      error: "Timeout - unidad asumida atascada (recuperación automática)",
    };
    for (const u of stuck) {
      await ctx.db.patch(u._id, { status: "failed", result: stuckError });
    }

    const progress = job.progress ?? { current: 0, total: units.length };
    const newCurrent = progress.current + stuck.length;
    await ctx.db.patch(jobId, {
      progress: { ...progress, current: newCurrent },
    });

    const jobAfter = await ctx.db.get(jobId);
    if (!jobAfter || jobAfter.status === "cancelled") return;

    const unitsAfter = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
    const doneCount = unitsAfter.filter(
      (u) => u.status === "completed" || u.status === "failed"
    ).length;

    if (PARALLEL_JOB_TYPES.has(jobAfter.jobType)) {
      if (doneCount < unitsAfter.length) {
        const pending = unitsAfter.filter((u) => u.status === "pending");
        const runningCount = unitsAfter.filter((u) => u.status === "running").length;
        const limit = getConcurrencyLimit(jobAfter);
        const toSchedule = Math.min(limit - runningCount, pending.length);
        const nextByOrder = [...pending].sort((a, b) => a.sortOrder - b.sortOrder);
        for (let i = 0; i < toSchedule; i++) {
          await ctx.scheduler.runAfter(i * 300, api.pipelineActions.processPipelineUnit, {
            jobId,
            unitId: nextByOrder[i].unitId,
          });
        }
        return;
      }
    } else {
      if (doneCount < unitsAfter.length) {
        const pending = unitsAfter.filter((u) => u.status === "pending");
        if (pending.length > 0) {
          const next = pending.reduce((a, b) =>
            a.sortOrder < b.sortOrder ? a : b
          );
          await ctx.scheduler.runAfter(0, api.pipelineActions.processPipelineUnit, {
            jobId,
            unitId: next.unitId,
          });
        }
        return;
      }
    }

    await runFinalize(ctx, jobId, jobAfter.jobType, jobAfter.scope as Record<string, unknown>, unitsAfter);
  },
});

/** Ajusta la concurrencia de un job (solo jobs paralelos). Si el job está running, programa más unidades de inmediato hasta llenar el nuevo límite. */
export const setPipelineJobConcurrency = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    maxConcurrency: v.number(),
  },
  handler: async (ctx, { jobId, maxConcurrency }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    if (!PARALLEL_JOB_TYPES.has(job.jobType)) return;

    const limit = Math.max(1, Math.min(32, maxConcurrency));
    await ctx.db.patch(jobId, { maxConcurrency: limit });

    if (job.status !== "running") return;

    const units = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
    const runningCount = units.filter((u) => u.status === "running").length;
    const pending = units.filter((u) => u.status === "pending");
    const toSchedule = Math.min(limit - runningCount, pending.length);
    if (toSchedule <= 0) return;

    const nextByOrder = [...pending].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < toSchedule; i++) {
      await ctx.scheduler.runAfter(i * 300, api.pipelineActions.processPipelineUnit, {
        jobId,
        unitId: nextByOrder[i].unitId,
      });
    }
  },
});

/** Reintento manual: pone una unidad fallida de nuevo en pending y la reprograma.
 * Si el result tiene continueState o resumeFromDay (timeout parcial), se mergea en el payload para reanudar. */
export const retryPipelineUnit = mutation({
  args: {
    jobId: v.id("pipelineJobs"),
    unitId: v.string(),
  },
  handler: async (ctx, { jobId, unitId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const units = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
    const unit = units.find((u) => u.unitId === unitId);
    if (!unit || unit.status !== "failed") return;

    const result = unit.result as Record<string, unknown> | undefined;
    const hasResumeState =
      result && (result.continueState != null || result.resumeFromDay != null);
    const resumePayload = hasResumeState
      ? {
          ...(unit.payload as Record<string, unknown>),
          ...(result!.continueState != null && { continueState: result.continueState }),
          ...(result!.resumeFromDay != null && { resumeFromDay: result.resumeFromDay }),
        }
      : undefined;

    await ctx.db.patch(unit._id, {
      status: "pending",
      result: undefined,
      startedAt: undefined,
      progressDetail: undefined,
      ...(resumePayload != null && { payload: resumePayload }),
    });
    if (job.status === "completed" || job.status === "failed") {
      await ctx.db.patch(jobId, { status: "running" });
    }
    await ctx.scheduler.runAfter(0, api.pipelineActions.processPipelineUnit, { jobId, unitId });
  },
});

/** Reintento manual: pone todas las unidades fallidas en pending y reprograma hasta llenar concurrencia.
 * Si el result de una unidad fallida tiene continueState o resumeFromDay (timeout parcial), se mergea en el payload
 * para que la siguiente ejecución reanude desde ese punto. */
export const retryFailedUnits = mutation({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const units = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
    const failed = units.filter((u) => u.status === "failed");
    if (failed.length === 0) return;

    for (const u of failed) {
      const result = u.result as Record<string, unknown> | undefined;
      const hasResumeState =
        result &&
        (result.continueState != null || result.resumeFromDay != null);
      const resumePayload = hasResumeState
        ? {
            ...(u.payload as Record<string, unknown>),
            ...(result!.continueState != null && { continueState: result.continueState }),
            ...(result!.resumeFromDay != null && { resumeFromDay: result.resumeFromDay }),
          }
        : undefined;
      await ctx.db.patch(u._id, {
        status: "pending",
        result: undefined,
        startedAt: undefined,
        progressDetail: undefined,
        ...(resumePayload != null && { payload: resumePayload }),
      });
    }
    await ctx.db.patch(jobId, { status: "running" });
    const limit = getConcurrencyLimit(job);
    const unitsAfter = await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
    const pending = unitsAfter.filter((u) => u.status === "pending");
    const toSchedule = Math.min(limit, pending.length);
    const nextByOrder = [...pending].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < toSchedule; i++) {
      await ctx.scheduler.runAfter(i * 300, api.pipelineActions.processPipelineUnit, {
        jobId,
        unitId: nextByOrder[i].unitId,
      });
    }
  },
});

async function runFinalize(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  jobType: string,
  scope: Record<string, unknown>,
  units: { unitId: string; status: string; result?: unknown; sortOrder: number }[]
): Promise<void> {
  const failedUnits = units.filter((u) => u.status === "failed");
  if (failedUnits.length > 0 && scope.strictMode === true) {
    const failedIds = failedUnits.map((u) => u.unitId).join(", ");
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Quality gate: hay ${failedUnits.length} unidad(es) fallidas (strictMode). Unidades: ${failedIds}. Reintentar con retryPipelineUnit o retryFailedUnits.`,
    });
    return;
  }

  const sorted = [...units].sort((a, b) => a.sortOrder - b.sortOrder);
  const completed = sorted.filter((u) => u.status === "completed");
  const results = completed.map((u) => u.result);

  switch (jobType) {
    case "datamapping_full_history":
      await finalizeFullHistory(ctx, jobId, results, units);
      break;
    case "datamapping_clear":
      await finalizeClear(ctx, jobId, results);
      break;
    case "datamapping_enrichment_by_months":
      await finalizeEnrichmentByMonths(ctx, jobId, results, sorted);
      break;
    case "datamapping_backfill_enrichment_by_months":
      await finalizeBackfillEnrichmentByMonths(ctx, jobId, results, sorted);
      break;
    case "datamapping_load_from_date":
      await finalizeLoadFromDate(ctx, jobId, results, sorted);
      break;
    case "datamapping_fecha_transaccion_from_date":
      await finalizeFechaTransaccionFromDate(ctx, jobId, results, sorted);
      break;
    case "datamapping_fecha_transaccion_full":
      await finalizeFechaTransaccionFull(ctx, jobId, results, sorted);
      break;
    case "datamapping_incremental":
      await finalizeSingleResult(ctx, jobId, results);
      break;
    case "datamapping_sync_by_months":
      await finalizeDatamappingSyncByMonths(ctx, jobId, results, sorted);
      break;
    case "datamapping_sync_by_range":
      await finalizeDatamappingSyncByRange(ctx, jobId, results, units);
      break;
    case "cloudwatch_sync_by_months":
      await finalizeCloudWatchSyncByMonths(ctx, jobId, results, sorted);
      break;
    case "cloudwatch_sync_by_range":
      await finalizeCloudWatchSyncByRange(ctx, jobId, results, units);
      break;
    case "cloudwatch_deterministic_sync_by_months":
      await finalizeCloudwatchDeterministicSyncByMonths(ctx, jobId, results, sorted);
      break;
    case "cloudwatch_deterministic_sync_by_range":
      await finalizeCloudwatchDeterministicSyncByRange(ctx, jobId, results, units);
      break;
    case "cloudwatch_incremental":
      await finalizeSingleResult(ctx, jobId, results);
      break;
    case "cloudwatch_clear":
      await finalizeCloudwatchClear(ctx, jobId, results, sorted);
      break;
    default:
      await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
        jobId,
        result: { summary: "Completado", results },
      });
  }
}

async function finalizeFullHistory(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[],
  allUnits?: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type RangeOk = {
    ym: string;
    startDay: number;
    endDay: number;
    status: "completed";
    inserted: number;
    updated: number;
    maxUpdatedAt: string | null;
  };
  type RangeFailed = { ym: string; startDay: number; endDay: number; status: "failed"; error: string };
  const rangeResults = results as (RangeOk | RangeFailed)[];
  if (allUnits) {
    for (const u of allUnits) {
      if (u.status === "failed" && u.result && typeof u.result === "object" && "error" in u.result) {
        const ym = (u.unitId.match(/^(\d{4}-\d{2})-/)?.[1]) ?? u.unitId;
        rangeResults.push({
          ym,
          startDay: 0,
          endDay: 0,
          status: "failed",
          error: (u.result as { error: string }).error,
        });
      }
    }
  }

  const byMonth = new Map<
    string,
    { inserted: number; updated: number; maxUpdatedAt: string | null; failed?: string }
  >();
  for (const r of rangeResults) {
    const ym = r.ym;
    if (!byMonth.has(ym)) {
      byMonth.set(ym, { inserted: 0, updated: 0, maxUpdatedAt: null });
    }
    const agg = byMonth.get(ym)!;
    if (r.status === "completed") {
      agg.inserted += r.inserted;
      agg.updated += r.updated;
      if (
        r.maxUpdatedAt &&
        (!agg.maxUpdatedAt || r.maxUpdatedAt > agg.maxUpdatedAt)
      ) {
        agg.maxUpdatedAt = r.maxUpdatedAt;
      }
    } else {
      agg.failed = (agg.failed ? agg.failed + "; " : "") + `días ${r.startDay}-${r.endDay}: ${(r as RangeFailed).error}`;
    }
  }

  const completedMonths: string[] = [];
  const failedMonths: { ym: string; error: string }[] = [];
  const byMonthOut: Record<
    string,
    { inserted?: number; updated?: number; status: string; error?: string }
  > = {};
  let maxWatermark: string | null = null;
  let totalInserted = 0;
  let totalUpdated = 0;

  for (const [ym, agg] of byMonth) {
    if (agg.failed) {
      failedMonths.push({ ym, error: agg.failed });
      byMonthOut[ym] = { status: "failed", error: agg.failed };
    } else {
      completedMonths.push(ym);
      byMonthOut[ym] = {
        inserted: agg.inserted,
        updated: agg.updated,
        status: "completed",
      };
      totalInserted += agg.inserted;
      totalUpdated += agg.updated;
      if (agg.maxUpdatedAt && (!maxWatermark || agg.maxUpdatedAt > maxWatermark)) {
        maxWatermark = agg.maxUpdatedAt;
      }
    }
  }

  if (maxWatermark) {
    await ctx.runMutation(api.datamappingMutations.setDatamappingWatermark, {
      lastUpdatedAt: maxWatermark,
    });
  }

  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      totalUpdated,
      byMonth: byMonthOut,
      completedMonths,
      failedMonths,
      newWatermark: maxWatermark,
      summary:
        failedMonths.length > 0
          ? `${completedMonths.length} meses ok, ${failedMonths.length} fallaron`
          : "Todos los meses completados",
    },
  });

  if (failedMonths.length > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Meses fallidos (${failedMonths.length}): ${failedMonths.map((r) => r.ym).join(", ")}. Revisar result.failedMonths.`,
    });
  }
  await ctx.scheduler.runAfter(0, api.actions.getDatamappingIngestionStats, {});
}

async function finalizeClear(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[]
): Promise<void> {
  const r = results[0] as { totalDeleted: number };
  await ctx.runMutation(api.datamappingMutations.clearDatamappingWatermark, {});
  await ctx.runMutation(api.datamappingMutations.clearDatamappingIngestionStats, {});
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: { totalDeleted: r?.totalDeleted ?? 0 },
  });
}

async function finalizeEnrichmentByMonths(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  _results: unknown[],
  sorted: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type ChunkOk = { ym?: string; processed: number; enriched: number };
  const byChunk: Record<string, { processed?: number; enriched?: number; status: string; error?: string }> = {};
  let totalProcessed = 0;
  let totalEnriched = 0;
  for (const u of sorted) {
    const key = u.unitId;
    if (u.status === "completed" && u.result != null && typeof u.result === "object") {
      const r = u.result as ChunkOk;
      const processed = typeof r.processed === "number" ? r.processed : 0;
      const enriched = typeof r.enriched === "number" ? r.enriched : 0;
      totalProcessed += processed;
      totalEnriched += enriched;
      byChunk[key] = { processed, enriched, status: "completed" };
    } else if (u.status === "failed" && u.result != null && typeof u.result === "object" && "error" in u.result) {
      byChunk[key] = { status: "failed", error: (u.result as { error: string }).error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalProcessed,
      totalEnriched,
      byChunk,
      completedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "completed")
        .map(([k]) => k),
      failedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "failed")
        .map(([k, v]) => ({ unitId: k, error: v.error })),
      summary: Object.values(byChunk).some((v) => v.status === "failed")
        ? `${Object.values(byChunk).filter((v) => v.status === "completed").length} bloques ok, ${Object.values(byChunk).filter((v) => v.status === "failed").length} fallaron`
        : "Enriquecimiento por bloques completado",
    },
  });
  const failedCount = Object.values(byChunk).filter((v) => v.status === "failed").length;
  if (failedCount > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Bloques fallidos (${failedCount}). Revisar result.failedChunks.`,
    });
  }
}

async function finalizeBackfillEnrichmentByMonths(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  _results: unknown[],
  sorted: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type ChunkOk = { fromDate?: string; toDate?: string; ym?: string; patched: number };
  const byChunk: Record<string, { patched?: number; status: string; error?: string }> = {};
  let totalPatched = 0;
  for (const u of sorted) {
    const key = u.unitId;
    if (u.status === "completed" && u.result != null && typeof u.result === "object") {
      const r = u.result as ChunkOk;
      const patched = typeof r.patched === "number" ? r.patched : 0;
      totalPatched += patched;
      byChunk[key] = { patched, status: "completed" };
    } else if (u.status === "failed" && u.result != null && typeof u.result === "object" && "error" in u.result) {
      byChunk[key] = { status: "failed", error: (u.result as { error: string }).error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalPatched,
      byChunk,
      completedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "completed")
        .map(([k]) => k),
      failedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "failed")
        .map(([k, v]) => ({ unitId: k, error: v.error })),
      summary: Object.values(byChunk).some((v) => v.status === "failed")
        ? `${Object.values(byChunk).filter((v) => v.status === "completed").length} bloques ok, ${Object.values(byChunk).filter((v) => v.status === "failed").length} fallaron`
        : `Backfill enrichment completado: ${totalPatched} registros actualizados`,
    },
  });
  const failedCount = Object.values(byChunk).filter((v) => v.status === "failed").length;
  if (failedCount > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Bloques fallidos (${failedCount}). Revisar result.failedChunks.`,
    });
  }
  await ctx.scheduler.runAfter(0, api.actions.getDatamappingIngestionStats, {});
}

async function finalizeFechaTransaccionFull(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  _results: unknown[],
  sorted: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type ChunkOk = { fromDate?: string; toDate?: string; ym?: string; processed: number; updated: number };
  type ChunkFailed = { error: string };
  const byChunk: Record<string, { processed?: number; updated?: number; status: string; error?: string }> = {};
  let totalProcessed = 0;
  let totalUpdated = 0;
  for (const u of sorted) {
    const key = u.unitId;
    if (u.status === "completed" && u.result != null && typeof u.result === "object") {
      const r = u.result as ChunkOk;
      const processed = typeof r.processed === "number" ? r.processed : 0;
      const updated = typeof r.updated === "number" ? r.updated : 0;
      totalProcessed += processed;
      totalUpdated += updated;
      byChunk[key] = { processed, updated, status: "completed" };
    } else if (u.status === "failed" && u.result != null && typeof u.result === "object" && "error" in u.result) {
      byChunk[key] = { status: "failed", error: (u.result as ChunkFailed).error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalProcessed,
      totalUpdated,
      byChunk,
      completedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "completed")
        .map(([k]) => k),
      failedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "failed")
        .map(([k, v]) => ({ unitId: k, error: v.error })),
      summary:
        Object.values(byChunk).some((v) => v.status === "failed")
          ? `${Object.values(byChunk).filter((v) => v.status === "completed").length} bloques ok, ${Object.values(byChunk).filter((v) => v.status === "failed").length} fallaron`
          : "Todos los bloques de fechaTransaccion (full) completados",
    },
  });
  const failedCount = Object.values(byChunk).filter((v) => v.status === "failed").length;
  if (failedCount > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Bloques fallidos (${failedCount}). Revisar result.failedChunks.`,
    });
  } else {
    await ctx.scheduler.runAfter(0, api.actions.recreateDatamappingMonthStatsByFechaTransaccion, {});
  }
}

async function finalizeSingleResult(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[]
): Promise<void> {
  const result = results[0] ?? {};
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result,
  });
}

async function finalizeCloudwatchClear(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  _results: unknown[],
  sorted: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type ChunkOk = { month?: string; totalDeleted: number };
  const byMonth: Record<string, { totalDeleted?: number; status: string; error?: string }> = {};
  let totalDeleted = 0;
  for (const u of sorted) {
    const key = u.unitId;
    if (u.status === "completed" && u.result != null && typeof u.result === "object") {
      const r = u.result as ChunkOk;
      const deleted = typeof r.totalDeleted === "number" ? r.totalDeleted : 0;
      totalDeleted += deleted;
      byMonth[key] = { totalDeleted: deleted, status: "completed" };
    } else if (u.status === "failed" && u.result != null && typeof u.result === "object" && "error" in u.result) {
      byMonth[key] = { status: "failed", error: (u.result as { error: string }).error };
    }
  }
  await ctx.runMutation(api.cloudwatchMutations.clearCloudwatchWatermark, {});
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalDeleted,
      byMonth,
      completedMonths: Object.entries(byMonth)
        .filter(([, v]) => v.status === "completed")
        .map(([k]) => k),
      failedMonths: Object.entries(byMonth)
        .filter(([, v]) => v.status === "failed")
        .map(([k, v]) => ({ unitId: k, error: v.error })),
      summary: Object.values(byMonth).some((v) => v.status === "failed")
        ? `${Object.values(byMonth).filter((v) => v.status === "completed").length} meses ok, ${Object.values(byMonth).filter((v) => v.status === "failed").length} fallaron`
        : `CloudWatch clear completado: ${totalDeleted} registros borrados`,
    },
  });
  const failedCount = Object.values(byMonth).filter((v) => v.status === "failed").length;
  if (failedCount > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Meses fallidos (${failedCount}). Revisar result.failedMonths.`,
    });
  }
}

async function finalizeFechaTransaccionFromDate(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[],
  sorted: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type ChunkOk = { fromDate?: string; toDate?: string; processed: number; updated: number };
  type ChunkFailed = { error: string };
  const byChunk: Record<string, { processed?: number; updated?: number; status: string; error?: string }> = {};
  let totalProcessed = 0;
  let totalUpdated = 0;
  for (const u of sorted) {
    const key = u.unitId;
    if (u.status === "completed" && u.result != null && typeof u.result === "object") {
      const r = u.result as ChunkOk;
      const processed = typeof r.processed === "number" ? r.processed : 0;
      const updated = typeof r.updated === "number" ? r.updated : 0;
      totalProcessed += processed;
      totalUpdated += updated;
      byChunk[key] = { processed, updated, status: "completed" };
    } else if (u.status === "failed" && u.result != null && typeof u.result === "object" && "error" in u.result) {
      byChunk[key] = { status: "failed", error: (u.result as ChunkFailed).error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalProcessed,
      totalUpdated,
      byChunk,
      completedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "completed")
        .map(([k]) => k),
      failedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "failed")
        .map(([k, v]) => ({ unitId: k, error: v.error })),
      summary:
        Object.values(byChunk).some((v) => v.status === "failed")
          ? `${Object.values(byChunk).filter((v) => v.status === "completed").length} bloques ok, ${Object.values(byChunk).filter((v) => v.status === "failed").length} fallaron`
          : "Todos los bloques de fechaTransaccion (from-date) completados",
    },
  });
  const failedCount = Object.values(byChunk).filter((v) => v.status === "failed").length;
  if (failedCount > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Bloques fallidos (${failedCount}). Revisar result.failedChunks.`,
    });
  } else {
    await ctx.scheduler.runAfter(0, api.actions.recreateDatamappingMonthStatsByFechaTransaccion, {});
  }
}

async function finalizeLoadFromDate(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  _results: unknown[],
  sorted: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type ChunkOk = { inserted: number; updated: number; pages?: number };
  const byChunk: Record<string, { inserted?: number; updated?: number; status: string; error?: string }> = {};
  let totalInserted = 0;
  let totalUpdated = 0;
  for (const u of sorted) {
    const key = u.unitId;
    if (u.status === "completed" && u.result != null && typeof u.result === "object") {
      const r = u.result as ChunkOk;
      const inserted = typeof r.inserted === "number" ? r.inserted : 0;
      const updated = typeof r.updated === "number" ? r.updated : 0;
      totalInserted += inserted;
      totalUpdated += updated;
      byChunk[key] = { inserted, updated, status: "completed" };
    } else if (u.status === "failed" && u.result != null && typeof u.result === "object" && "error" in u.result) {
      byChunk[key] = { status: "failed", error: (u.result as { error: string }).error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      totalUpdated,
      byChunk,
      completedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "completed")
        .map(([k]) => k),
      failedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "failed")
        .map(([k, v]) => ({ unitId: k, error: v.error })),
      summary: Object.values(byChunk).some((v) => v.status === "failed")
        ? `${Object.values(byChunk).filter((v) => v.status === "completed").length} bloques ok, ${Object.values(byChunk).filter((v) => v.status === "failed").length} fallaron`
        : "Carga desde fecha completada por bloques",
    },
  });
  const failedCount = Object.values(byChunk).filter((v) => v.status === "failed").length;
  if (failedCount > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Bloques fallidos (${failedCount}). Revisar result.failedChunks.`,
    });
  }
  await ctx.scheduler.runAfter(0, api.actions.getDatamappingIngestionStats, {});
}

async function finalizeDatamappingSyncByMonths(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  _results: unknown[],
  sorted: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type ChunkOk = { ym?: string; inserted: number; updated: number };
  const byChunk: Record<string, { inserted?: number; updated?: number; status: string; error?: string }> = {};
  let totalInserted = 0;
  let totalUpdated = 0;
  for (const u of sorted) {
    const key = u.unitId;
    if (u.status === "completed" && u.result != null && typeof u.result === "object") {
      const r = u.result as ChunkOk;
      const inserted = typeof r.inserted === "number" ? r.inserted : 0;
      const updated = typeof r.updated === "number" ? r.updated : 0;
      totalInserted += inserted;
      totalUpdated += updated;
      byChunk[key] = { inserted, updated, status: "completed" };
    } else if (u.status === "failed" && u.result != null && typeof u.result === "object" && "error" in u.result) {
      byChunk[key] = { status: "failed", error: (u.result as { error: string }).error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      totalUpdated,
      byChunk,
      completedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "completed")
        .map(([k]) => k),
      failedChunks: Object.entries(byChunk)
        .filter(([, v]) => v.status === "failed")
        .map(([k, v]) => ({ unitId: k, error: v.error })),
      summary: Object.values(byChunk).some((v) => v.status === "failed")
        ? `${Object.values(byChunk).filter((v) => v.status === "completed").length} bloques ok, ${Object.values(byChunk).filter((v) => v.status === "failed").length} fallaron`
        : "Sync por meses (DataMapping) completado por bloques",
    },
  });
  const failedCount = Object.values(byChunk).filter((v) => v.status === "failed").length;
  if (failedCount > 0) {
    const detail = Object.entries(byChunk)
      .filter(([, v]) => v.status === "failed")
      .map(([k, v]) => `${k}: ${(v.error ?? "").trim().slice(0, 400)}`)
      .join(" | ");
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Bloques fallidos (${failedCount}): ${detail}`.slice(0, 2000),
    });
  }
  await ctx.scheduler.runAfter(0, api.actions.getDatamappingIngestionStats, {});
}

async function finalizeDatamappingSyncByRange(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[],
  allUnits?: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type DayOk = { date: string; status: "completed"; inserted: number; updated: number };
  type DayFailed = { date: string; status: "failed"; error: string };
  const list = results as (DayOk | DayFailed)[];
  if (allUnits) {
    for (const u of allUnits) {
      if (u.status === "failed" && u.result && typeof u.result === "object" && "error" in u.result) {
        list.push({ date: u.unitId, status: "failed", error: (u.result as { error: string }).error });
      }
    }
  }
  const completed = list.filter((r): r is DayOk => r.status === "completed");
  const failed = list.filter((r): r is DayFailed => r.status === "failed");
  const totalInserted = completed.reduce((s, r) => s + r.inserted, 0);
  const totalUpdated = completed.reduce((s, r) => s + r.updated, 0);
  const byDate: Record<string, { inserted?: number; updated?: number; status: string; error?: string }> = {};
  for (const r of list) {
    if (r.status === "completed") {
      byDate[r.date] = { inserted: r.inserted, updated: r.updated, status: "completed" };
    } else {
      byDate[r.date] = { status: "failed", error: r.error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      totalUpdated,
      byDate,
      completedDays: completed.map((r) => r.date),
      failedDays: failed.map((r) => ({ date: r.date, error: r.error })),
      summary:
        failed.length > 0
          ? `${completed.length} días ok, ${failed.length} fallaron`
          : "Todos los días del rango completados",
    },
  });
  if (failed.length > 0) {
    const detail = failed
      .map((r) => {
        const msg = (r.error ?? "").trim().slice(0, 400);
        return `${r.date}: ${msg || "(sin mensaje — posible timeout ~5 min)"}`;
      })
      .join(" | ");
    const errorMessage = `Días fallidos (${failed.length}): ${detail}`.slice(0, 2000);
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage,
    });
  }
  await ctx.scheduler.runAfter(0, api.actions.getDatamappingIngestionStats, {});
}

function parseCloudWatchRangeUnitId(unitId: string): { ym: string; start: number; end: number } | null {
  const m = unitId.match(/^(\d{4}-\d{2})-dias-(\d+)-(\d+)$/);
  if (!m) return null;
  return { ym: m[1], start: parseInt(m[2], 10), end: parseInt(m[3], 10) };
}

async function finalizeCloudWatchSyncByMonths(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[],
  allUnits?: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type RangeOk = {
    ym: string;
    startDay: number;
    endDay: number;
    status: "completed";
    inserted: number;
    deleted: number;
    lastProcessedDate?: string | null;
    failedDays?: string[];
  };
  const rangeResults = results as RangeOk[];
  const failedDays: { date: string; error: string }[] = [];
  if (allUnits) {
    for (const u of allUnits) {
      if (u.status === "failed" && u.result && typeof u.result === "object" && "error" in u.result) {
        const parsed = parseCloudWatchRangeUnitId(u.unitId);
        const err = (u.result as { error: string }).error;
        if (parsed) {
          for (let d = parsed.start; d <= parsed.end; d++) {
            failedDays.push({
              date: `${parsed.ym}-${String(d).padStart(2, "0")}`,
              error: err,
            });
          }
        } else {
          failedDays.push({ date: u.unitId, error: err });
        }
      }
    }
  }
  const byMonth: Record<
    string,
    { inserted?: number; deleted?: number; status: string; error?: string; failedDays?: string[] }
  > = {};
  let totalInserted = 0;
  let totalDeleted = 0;
  const completedDates: string[] = [];
  for (const r of rangeResults) {
    if (r.status === "completed" && r.ym) {
      const ym = r.ym;
      if (!byMonth[ym]) byMonth[ym] = { inserted: 0, deleted: 0, status: "completed" };
      byMonth[ym].inserted = (byMonth[ym].inserted ?? 0) + r.inserted;
      byMonth[ym].deleted = (byMonth[ym].deleted ?? 0) + r.deleted;
      totalInserted += r.inserted;
      totalDeleted += r.deleted;
      if (r.lastProcessedDate) completedDates.push(r.lastProcessedDate);
      if (r.failedDays?.length) {
        if (!byMonth[ym].failedDays) byMonth[ym].failedDays = [];
        byMonth[ym].failedDays!.push(...r.failedDays);
        byMonth[ym].status = "failed";
      }
    }
  }
  for (const { date, error } of failedDays) {
    const ym = date.substring(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { status: "failed", failedDays: [] };
    if (!byMonth[ym].failedDays) byMonth[ym].failedDays = [];
    byMonth[ym].failedDays!.push(date);
    byMonth[ym].status = "failed";
    byMonth[ym].error = (byMonth[ym].error ? byMonth[ym].error + "; " : "") + `${date}: ${error}`;
  }
  const completedMonths = Object.entries(byMonth).filter(([, v]) => v.status === "completed").map(([ym]) => ym);
  const failedMonths = Object.entries(byMonth).filter(([, v]) => v.status === "failed").map(([ym]) => ({ ym, error: byMonth[ym].error ?? "" }));
  const totalFailedDays = failedDays.length + (rangeResults.flatMap((r) => r.failedDays ?? []).length);
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      totalDeleted,
      byMonth,
      completedMonths,
      failedMonths,
      completedDays: completedDates.length,
      failedDays: totalFailedDays,
      summary:
        failedMonths.length > 0
          ? `${completedMonths.length} meses ok, ${failedMonths.length} con fallos (${totalFailedDays} días fallaron)`
          : "Todos los rangos de CloudWatch completados",
    },
  });
  if (failedMonths.length > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Días fallidos (${totalFailedDays}). Revisar result.byMonth.`,
    });
  }
  const maxCompletedDate = completedDates.sort()[completedDates.length - 1];
  if (maxCompletedDate) {
    await ctx.runMutation(api.cloudwatchMutations.setCloudwatchWatermark, {
      lastSyncedDate: maxCompletedDate,
    });
  }
  await ctx.scheduler.runAfter(0, api.actions.recreateAllMonthStatsFromPaymentRecords, {});
}

async function finalizeCloudWatchSyncByRange(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[],
  allUnits?: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  type DayOk = { date: string; status: "completed"; inserted: number; deleted: number };
  type DayFailed = { date: string; status: "failed"; error: string };
  const list = results as (DayOk | DayFailed)[];
  if (allUnits) {
    for (const u of allUnits) {
      if (u.status === "failed" && u.result && typeof u.result === "object" && "error" in u.result) {
        list.push({ date: u.unitId, status: "failed", error: (u.result as { error: string }).error });
      }
    }
  }
  const completed = list.filter((r): r is DayOk => r.status === "completed");
  const failed = list.filter((r): r is DayFailed => r.status === "failed");
  const totalInserted = completed.reduce((s, r) => s + r.inserted, 0);
  const totalDeleted = completed.reduce((s, r) => s + r.deleted, 0);
  const byDate: Record<string, { inserted?: number; deleted?: number; status: string; error?: string }> = {};
  for (const r of list) {
    if (r.status === "completed") {
      byDate[r.date] = { inserted: r.inserted, deleted: r.deleted, status: "completed" };
    } else {
      byDate[r.date] = { status: "failed", error: r.error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      totalDeleted,
      byDate,
      completedDays: completed.map((r) => r.date),
      failedDays: failed.map((r) => ({ date: r.date, error: r.error })),
      summary:
        failed.length > 0
          ? `${completed.length} días ok, ${failed.length} fallaron`
          : "Todos los días del rango completados",
    },
  });
  if (failed.length > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Días fallidos (${failed.length}): ${failed.map((r) => r.date).join(", ")}. Revisar result.failedDays.`,
    });
  }
  const completedDates = completed.map((r) => r.date).sort();
  const maxCompletedDate = completedDates[completedDates.length - 1];
  if (maxCompletedDate) {
    await ctx.runMutation(api.cloudwatchMutations.setCloudwatchWatermark, {
      lastSyncedDate: maxCompletedDate,
    });
  }
  await ctx.scheduler.runAfter(0, api.actions.recreateAllMonthStatsFromPaymentRecords, {});
}

type DetRangeOk = { date: string; bySource: Record<string, { expected: number; inserted: number }>; ok: boolean; status: "completed" };
type DetRangeFailed = { date: string; status: "failed"; error: string };

async function finalizeCloudwatchDeterministicSyncByRange(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[],
  allUnits?: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  const list = results as (DetRangeOk | DetRangeFailed)[];
  if (allUnits) {
    for (const u of allUnits) {
      if (u.status === "failed" && u.result && typeof u.result === "object" && "error" in u.result) {
        const unitId = (u.unitId as string).replace(/^det-/, "");
        list.push({ date: unitId, status: "failed", error: (u.result as { error: string }).error });
      }
    }
  }
  const completed = list.filter((r): r is DetRangeOk => r.status === "completed");
  const failed = list.filter((r): r is DetRangeFailed => r.status === "failed");
  const totalInserted = completed.reduce(
    (s, r) => s + Object.values(r.bySource).reduce((t, x) => t + x.inserted, 0),
    0
  );
  const byDate: Record<string, { bySource?: Record<string, { expected: number; inserted: number }>; status: string; error?: string }> = {};
  for (const r of list) {
    if (r.status === "completed") {
      byDate[r.date] = { bySource: r.bySource, status: "completed" };
    } else {
      byDate[r.date] = { status: "failed", error: r.error };
    }
  }
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      byDate,
      completedDays: completed.map((r) => r.date),
      failedDays: failed.map((r) => ({ date: r.date, error: r.error })),
      summary:
        failed.length > 0
          ? `${completed.length} días ok, ${failed.length} fallaron (tablas fuente; consolidación aparte)`
          : "Sync determinístico por rango completado (tablas fuente; consolidación aparte)",
    },
  });
  if (failed.length > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Días fallidos (${failed.length}): ${failed.map((r) => r.date).join(", ")}. Revisar result.failedDays.`,
    });
  }
}

type DetMonthOk = {
  ym: string;
  startDay: number;
  endDay: number;
  byDay: Record<string, { bySource: Record<string, { expected: number; inserted: number }> }>;
  totalInserted: number;
  status: "completed";
};
type DetMonthFailed = { ym: string; startDay: number; endDay: number; status: "failed"; error: string };

async function finalizeCloudwatchDeterministicSyncByMonths(
  ctx: MutationCtx,
  jobId: Id<"pipelineJobs">,
  results: unknown[],
  allUnits?: { unitId: string; status: string; result?: unknown }[]
): Promise<void> {
  const rangeResults = results as DetMonthOk[];
  const failedDays: { date: string; error: string }[] = [];
  if (allUnits) {
    for (const u of allUnits) {
      if (u.status === "failed" && u.result && typeof u.result === "object" && "error" in u.result) {
        const parsed = parseCloudWatchRangeUnitId((u.unitId as string).replace(/^det-/, ""));
        const err = (u.result as { error: string }).error;
        if (parsed) {
          for (let d = parsed.start; d <= parsed.end; d++) {
            failedDays.push({ date: `${parsed.ym}-${String(d).padStart(2, "0")}`, error: err });
          }
        } else {
          failedDays.push({ date: u.unitId as string, error: err });
        }
      }
    }
  }
  const byMonth: Record<string, { totalInserted?: number; status: string; error?: string; failedDays?: string[] }> = {};
  let totalInserted = 0;
  const completedDates: string[] = [];
  for (const r of rangeResults) {
    if (r.status === "completed" && r.ym) {
      const ym = r.ym;
      if (!byMonth[ym]) byMonth[ym] = { totalInserted: 0, status: "completed" };
      byMonth[ym].totalInserted = (byMonth[ym].totalInserted ?? 0) + r.totalInserted;
      totalInserted += r.totalInserted;
      for (const date of Object.keys(r.byDay ?? {})) {
        completedDates.push(date);
      }
    }
  }
  for (const { date, error } of failedDays) {
    const ym = date.substring(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { status: "failed", failedDays: [] };
    if (!byMonth[ym].failedDays) byMonth[ym].failedDays = [];
    byMonth[ym].failedDays!.push(date);
    byMonth[ym].status = "failed";
    byMonth[ym].error = (byMonth[ym].error ? byMonth[ym].error + "; " : "") + `${date}: ${error}`;
  }
  const completedMonths = Object.entries(byMonth).filter(([, v]) => v.status === "completed").map(([ym]) => ym);
  const failedMonths = Object.entries(byMonth).filter(([, v]) => v.status === "failed").map(([ym]) => ({ ym, error: byMonth[ym].error ?? "" }));
  await ctx.runMutation(api.pipelineMutations.updatePipelineJobResult, {
    jobId,
    result: {
      totalInserted,
      byMonth,
      completedMonths,
      failedMonths,
      completedDays: completedDates.length,
      failedDays: failedDays.length,
      summary:
        failedMonths.length > 0
          ? `${completedMonths.length} meses ok, ${failedMonths.length} con fallos (tablas fuente; consolidación aparte)`
          : "Sync determinístico por meses completado (tablas fuente; consolidación aparte)",
    },
  });
  if (failedMonths.length > 0) {
    await ctx.runMutation(api.pipelineMutations.updatePipelineJobError, {
      jobId,
      errorMessage: `Días fallidos (${failedDays.length}). Revisar result.byMonth.`,
    });
  }
}

/** Cancela un job en ejecución; el motor no programará más unidades. */
export const cancelPipelineJob = mutation({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    if (job.status === "running" || job.status === "pending") {
      await ctx.db.patch(jobId, { status: "cancelled" });
    }
  },
});
