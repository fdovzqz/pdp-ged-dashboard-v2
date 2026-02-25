import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

/** Lista jobs paginados por startedAt descendente, con filtros opcionales. */
export const listPipelineJobs = query({
  args: {
    paginationOpts: paginationOptsValidator,
    _refresh: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    jobType: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, status, jobType }) => {
    let q = ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc");
    if (status != null) {
      q = q.filter((q) => q.eq(q.field("status"), status));
    }
    if (jobType != null) {
      q = q.filter((q) => q.eq(q.field("jobType"), jobType));
    }
    const result = await q.paginate(paginationOpts);
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Eventos de auditoría de un job (trazabilidad run/unit). */
export const getAuditEventsForJob = query({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    return await ctx.db
      .query("auditEvents")
      .withIndex("by_jobId_timestamp", (q) => q.eq("jobId", jobId))
      .order("asc")
      .collect();
  },
});

/** Export de evidencia auditiva para un job (eventos + resumen del job). */
export const getAuditEvidenceForJob = query({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_jobId_timestamp", (q) => q.eq("jobId", jobId))
      .order("asc")
      .collect();
    return {
      jobId,
      jobType: job.jobType,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      scope: job.scope,
      eventCount: events.length,
      events,
    };
  },
});

/** Obtiene el job más reciente de clear datamapping (para UI). */
export const getLatestDatamappingClearJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) => q.eq(q.field("jobType"), "datamapping_clear"))
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de extracción histórica datamapping (para UI). */
export const getLatestDatamappingFullHistoryJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "datamapping_full_history")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de backfill fechaTransaccion completo (para UI). */
export const getLatestFechaTransaccionFullJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "datamapping_fecha_transaccion_full")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de sync CloudWatch por meses (para UI). */
export const getLatestCloudwatchSyncByMonthsJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "cloudwatch_sync_by_months")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de sync CloudWatch por rango de días (para UI). */
export const getLatestCloudwatchSyncByRangeJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "cloudwatch_sync_by_range")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de sync CloudWatch determinístico por meses (para UI). */
export const getLatestCloudwatchDeterministicSyncByMonthsJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "cloudwatch_deterministic_sync_by_months")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de sync CloudWatch determinístico por rango (para UI). */
export const getLatestCloudwatchDeterministicSyncByRangeJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "cloudwatch_deterministic_sync_by_range")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de incremental CloudWatch (para UI). */
export const getLatestCloudwatchIncrementalJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "cloudwatch_incremental")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de borrado CloudWatch (para UI). */
export const getLatestCloudwatchClearJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "cloudwatch_clear")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de sync DataMapping por meses (para UI). */
export const getLatestDatamappingSyncByMonthsJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "datamapping_sync_by_months")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de sync DataMapping por rango de días (para UI). */
export const getLatestDatamappingSyncByRangeJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "datamapping_sync_by_range")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de carga DataMapping desde fecha (para UI). */
export const getLatestDatamappingLoadFromDateJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "datamapping_load_from_date")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de incremental DataMapping (para UI). */
export const getLatestDatamappingIncrementalJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "datamapping_incremental")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene el job más reciente de enriquecimiento DataMapping por meses (para UI). */
export const getLatestDatamappingEnrichmentByMonthsJob = query({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("pipelineJobs")
      .withIndex("by_startedAt", (q) => q.gte("startedAt", 0))
      .order("desc")
      .filter((q) =>
        q.eq(q.field("jobType"), "datamapping_enrichment_by_months")
      )
      .take(1);
    return jobs[0] ?? null;
  },
});

/** Obtiene un job por id (para detalle/modal). */
export const getPipelineJob = query({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    return await ctx.db.get(jobId);
  },
});

/** Lista todas las unidades de un job (para el motor de pipeline). */
export const getPipelineJobUnitsByJobId = query({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    return await ctx.db
      .query("pipelineJobUnits")
      .withIndex("by_jobId", (q) => q.eq("jobId", jobId))
      .collect();
  },
});
