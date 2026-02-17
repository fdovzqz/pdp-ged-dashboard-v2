"use node";

import { inngest } from "./client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/**
 * Llena fechaTransaccion en datamappingRecords desde una fecha dada (sinceDate).
 * Crea un pipeline job para que la UI muestre progreso y resultado.
 */
export const datamappingFechaTransaccionFromDate = inngest.createFunction(
  {
    id: "datamapping-fecha-transaccion-from-date",
    name: "Datamapping: llenar fechaTransaccion desde fecha",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const originalEvent = (
        event as { data?: { event?: { data?: { jobId: Id<"pipelineJobs"> } } } }
      ).data?.event?.data;
      const jobId = originalEvent?.jobId;
      if (!jobId) return;
      const client = new ConvexHttpClient(getConvexUrl());
      await client.mutation(api.pipelineJobs.updatePipelineJobError, {
        jobId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    },
  },
  { event: "reconciliation/datamapping.fecha-transaccion-from-date" },
  async ({ event, step }) => {
    const { jobId, sinceDate } = event.data as {
      jobId: Id<"pipelineJobs">;
      sinceDate: string;
    };
    const client = new ConvexHttpClient(getConvexUrl());

    await step.run("marcar-running", async () => {
      await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
        jobId,
        status: "running",
        progress: {
          current: 0,
          unit: "records",
          message: `Llenando fechaTransaccion desde ${sinceDate}...`,
        },
      });
      return { ok: true };
    });

    const summary = await step.run("llenar-paginas", async () => {
      let totalProcessed = 0;
      let totalUpdated = 0;
      let continueState: { cursor: string | null } | undefined;
      let isDone = false;

      do {
        const result = (await client.action(
          api.actions.backfillFechaTransaccionForDatamapping,
          { sinceDate, continueState, maxDurationMs: 85_000 }
        )) as {
          processed: number;
          updated: number;
          isDone: boolean;
          continueState?: { cursor: string | null };
        };

        totalProcessed += result.processed;
        totalUpdated += result.updated;
        continueState = result.continueState;
        isDone = result.isDone;

        await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
          jobId,
          status: "running",
          progress: {
            current: totalProcessed,
            unit: "records",
            message: `Procesados: ${totalProcessed}, actualizados: ${totalUpdated}`,
          },
        });

        if (isDone) break;
      } while (continueState);

      return {
        sinceDate,
        processed: totalProcessed,
        updated: totalUpdated,
      };
    });

    await step.run("completar-job", async () => {
      await client.mutation(api.pipelineJobs.updatePipelineJobResult, {
        jobId,
        result: summary,
      });
      return { ok: true };
    });

    return { ok: true, jobId, ...summary };
  }
);
