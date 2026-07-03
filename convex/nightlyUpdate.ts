import { internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { timestampToMexicoDate } from "./lib/mexicoDate";

/**
 * Actualización nocturna automática (ver docs/runbook-actualizacion-datos.md).
 * Cadena: sync CloudWatch + sync DataMapping (últimos 3 días) → backfill
 * fechaTransaccion → agregados + stats del mes en curso (y el anterior si el
 * mes acaba de empezar). Orquestada como máquina de estados con el scheduler:
 * cada paso re-agenda `advance` hasta que los jobs del paso terminan.
 */

const CHECK_INTERVAL_MS = 2 * 60 * 1000;
/** ~4 horas de espera máxima por etapa antes de abandonar la corrida. */
const MAX_ATTEMPTS = 120;
/** Días hacia atrás que se re-sincronizan cada noche (upserts idempotentes). */
const SYNC_DAYS_BACK = 2;

function mexicoToday(): string {
  return timestampToMexicoDate(new Date().toISOString());
}

function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Meses YYYY-MM a recalcular: el del endDate y el anterior si el rango lo toca. */
function monthsForRange(startDate: string, endDate: string): string[] {
  const months = new Set<string>([startDate.slice(0, 7), endDate.slice(0, 7)]);
  return [...months].sort();
}

/** Punto de entrada del cron. Lanza los dos syncs y agenda el avance de la cadena. */
export const start = internalMutation({
  args: {},
  handler: async (ctx) => {
    const endDate = mexicoToday();
    const startDate = shiftDate(endDate, -SYNC_DAYS_BACK);

    const cwJobId = (await ctx.db.insert("pipelineJobs", {
      jobType: "cloudwatch_sync_by_range",
      scope: { startDate, endDate },
      status: "pending",
      startedAt: Date.now(),
      externalId: `nightly-cw-${endDate}`,
    })) as Id<"pipelineJobs">;
    const dmJobId = (await ctx.db.insert("pipelineJobs", {
      jobType: "datamapping_sync_by_range",
      scope: { startDate, endDate },
      status: "pending",
      startedAt: Date.now(),
      externalId: `nightly-dm-${endDate}`,
    })) as Id<"pipelineJobs">;

    await ctx.scheduler.runAfter(0, api.pipelineMutations.startPipelineJob, {
      jobId: cwJobId,
    });
    await ctx.scheduler.runAfter(0, api.pipelineMutations.startPipelineJob, {
      jobId: dmJobId,
    });

    await ctx.scheduler.runAfter(CHECK_INTERVAL_MS, internal.nightlyUpdate.advance, {
      stage: "syncs",
      startDate,
      endDate,
      waitJobIds: [cwJobId, dmJobId],
      attempt: 0,
    });
    console.log(`[nightly] iniciada: ${startDate} → ${endDate} (cw=${cwJobId}, dm=${dmJobId})`);
  },
});

/** Avanza la cadena cuando los jobs de la etapa actual terminan. */
export const advance = internalMutation({
  args: {
    stage: v.union(v.literal("syncs"), v.literal("fecha")),
    startDate: v.string(),
    endDate: v.string(),
    waitJobIds: v.array(v.id("pipelineJobs")),
    attempt: v.number(),
  },
  handler: async (ctx, { stage, startDate, endDate, waitJobIds, attempt }) => {
    if (attempt > MAX_ATTEMPTS) {
      console.error(`[nightly] etapa ${stage} superó el tiempo máximo; corrida abandonada`);
      return;
    }

    for (const jobId of waitJobIds) {
      const job = await ctx.db.get(jobId);
      if (!job) {
        console.error(`[nightly] job ${jobId} no existe; corrida abandonada`);
        return;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        console.error(
          `[nightly] job ${job.jobType} terminó ${job.status}: ${job.errorMessage ?? ""}; corrida abandonada`
        );
        return;
      }
      if (job.status !== "completed") {
        await ctx.scheduler.runAfter(CHECK_INTERVAL_MS, internal.nightlyUpdate.advance, {
          stage,
          startDate,
          endDate,
          waitJobIds,
          attempt: attempt + 1,
        });
        return;
      }
    }

    if (stage === "syncs") {
      const fechaJobId = (await ctx.db.insert("pipelineJobs", {
        jobType: "datamapping_fecha_transaccion_full",
        scope: { mode: "full", startDate, endDate },
        status: "pending",
        startedAt: Date.now(),
        externalId: `nightly-fecha-${endDate}`,
      })) as Id<"pipelineJobs">;
      await ctx.scheduler.runAfter(0, api.pipelineMutations.startPipelineJob, {
        jobId: fechaJobId,
      });
      await ctx.scheduler.runAfter(CHECK_INTERVAL_MS, internal.nightlyUpdate.advance, {
        stage: "fecha",
        startDate,
        endDate,
        waitJobIds: [fechaJobId],
        attempt: 0,
      });
      console.log(`[nightly] syncs listos; backfill fechaTransaccion ${fechaJobId}`);
      return;
    }

    // stage === "fecha": recalcular agregados y stats; fin de la cadena.
    const months = monthsForRange(startDate, endDate);
    await ctx.scheduler.runAfter(0, api.datamappingETL.buildDatamappingAggregates, {
      months,
    });
    await ctx.scheduler.runAfter(
      60 * 1000,
      api.datamappingActions.recreateDatamappingMonthStatsByFechaTransaccion,
      {}
    );
    console.log(`[nightly] backfill listo; agregados programados para ${months.join(", ")}`);
  },
});
