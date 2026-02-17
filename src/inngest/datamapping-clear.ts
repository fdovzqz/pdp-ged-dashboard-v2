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
 * Borra todos los datamappingRecords por lotes vía Inngest.
 * También borra la marca de agua para extracción incremental.
 * Actualiza el pipeline job en Convex para que la UI vea el avance.
 */
export const datamappingClear = inngest.createFunction(
  {
    id: "datamapping-clear",
    name: "Datamapping: clear table",
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
  { event: "reconciliation/datamapping.clear" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: Id<"pipelineJobs"> };
    const client = new ConvexHttpClient(getConvexUrl());

    await step.run("marcar-running", async () => {
      await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
        jobId,
        status: "running",
        progress: {
          current: 0,
          unit: "records",
          message: "Iniciando borrado...",
        },
      });
      return { ok: true };
    });

    const { totalDeleted } = await step.run("borrar-lotes", async () => {
      let totalDeleted = 0;
      let batchCount = 0;
      const progressInterval = 50; // actualizar cada 50 lotes

      while (true) {
        const res = (await client.mutation(
          api.mutations.deleteDatamappingRecordsBatch,
          {}
        )) as { deleted: number };
        totalDeleted += res.deleted;
        batchCount += 1;

        if (res.deleted === 0) break;

        if (batchCount % progressInterval === 0) {
          await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
            jobId,
            progress: {
              current: totalDeleted,
              unit: "records",
              message: `${totalDeleted} registros borrados...`,
            },
          });
        }
      }

      // actualizar progreso final
      await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
        jobId,
        progress: {
          current: totalDeleted,
          unit: "records",
          message: `${totalDeleted} registros borrados`,
        },
      });

      return { totalDeleted };
    });

    await step.run("limpiar-watermark-y-completar", async () => {
      await client.mutation(api.mutations.clearDatamappingWatermark, {});

      await client.mutation(api.pipelineJobs.updatePipelineJobResult, {
        jobId,
        result: { totalDeleted },
      });

      return { ok: true, totalDeleted };
    });

    return { ok: true, jobId, totalDeleted };
  }
);
