"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getUnitHandler } from "./lib/unitHandlers";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("OptimisticConcurrencyControlFailure") ||
    msg.includes("CommitterFullError") ||
    msg.includes("Too many concurrent commits") ||
    msg.includes("Documents read from or written to") ||
    msg.includes("changed while this mutation")
  );
}

/** Llama a reportPipelineUnitComplete con reintentos ante OCC / CommitterFullError. */
async function reportUnitCompleteWithRetry(
  ctx: ActionCtx,
  args: { jobId: Id<"pipelineJobs">; unitId: string; result: unknown; failed?: boolean }
): Promise<void> {
  const maxRetries = 8;
  const baseDelayMs = 800;
  let last: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await ctx.runMutation(api.pipelineMutations.reportPipelineUnitComplete, args);
      return;
    } catch (e) {
      last = e;
      if (i < maxRetries && isRetryableError(e)) {
        const delayMs = baseDelayMs * Math.pow(2, i);
        await sleep(Math.min(delayMs, 15_000));
      } else {
        throw e;
      }
    }
  }
  throw last;
}

/** Comprueba si el job fue cancelado (para parar unidades largas sin esperar al final). */
async function isJobCancelled(
  ctx: ActionCtx,
  jobId: Id<"pipelineJobs">
): Promise<boolean> {
  const job = await ctx.runQuery(api.pipelineQueries.getPipelineJob, { jobId });
  return job?.status === "cancelled";
}

/** Actualiza progreso de una unidad con reintentos ante OCC (varios workers actualizando a la vez). */
export const updatePipelineUnitProgressWithRetry = action({
  args: {
    jobId: v.id("pipelineJobs"),
    unitId: v.string(),
    progressDetail: v.object({
      processed: v.number(),
      enriched: v.optional(v.number()),
      updated: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const maxRetries = 8;
    const baseDelayMs = 500;
    let last: unknown;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        await ctx.runMutation(api.pipelineMutations.updatePipelineUnitProgress, args);
        return;
      } catch (e) {
        last = e;
        if (i < maxRetries && isRetryableError(e)) {
          await sleep(Math.min(baseDelayMs * Math.pow(2, i), 15_000));
        } else {
          throw e;
        }
      }
    }
    throw last;
  },
});

/** Ejecuta una unidad del pipeline según jobType. */
export const processPipelineUnit = action({
  args: {
    jobId: v.id("pipelineJobs"),
    unitId: v.string(),
  },
  handler: async (ctx, { jobId, unitId }) => {
    const job = await ctx.runQuery(api.pipelineQueries.getPipelineJob, { jobId });
    if (!job || job.status === "cancelled") return;

    const units = await ctx.runQuery(api.pipelineQueries.getPipelineJobUnitsByJobId, {
      jobId,
    });
    const unit = units.find((u) => u.unitId === unitId);
    if (!unit || unit.status !== "pending") return;

    await ctx.runMutation(api.pipelineMutations.markPipelineUnitRunning, {
      unitId: unit._id,
    });

    try {
      const handler = getUnitHandler(job.jobType);
      if (!handler) {
        throw new Error(`Unknown jobType: ${job.jobType}`);
      }
      const result = await handler(ctx, jobId, unit.payload as Record<string, unknown>);
      await reportUnitCompleteWithRetry(ctx, {
        jobId,
        unitId,
        result,
        failed: false,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const unitResult =
        err && typeof (err as { unitResult?: unknown }).unitResult === "object"
          ? (err as { unitResult: Record<string, unknown> }).unitResult
          : undefined;
      await reportUnitCompleteWithRetry(ctx, {
        jobId,
        unitId,
        result: { error: errorMessage, ...unitResult },
        failed: true,
      });
    }
  },
});
