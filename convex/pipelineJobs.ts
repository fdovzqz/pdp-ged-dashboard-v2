import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

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

/** Obtiene un job por id (para detalle/modal). */
export const getPipelineJob = query({
  args: { jobId: v.id("pipelineJobs") },
  handler: async (ctx, { jobId }) => {
    return await ctx.db.get(jobId);
  },
});
