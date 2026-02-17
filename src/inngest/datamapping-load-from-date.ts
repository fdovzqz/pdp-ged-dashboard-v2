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

type FetchPageResult = {
  inserted: number;
  updated: number;
  hasMore: boolean;
  lastEvaluatedKey?: string;
  pageCount: number;
};

/**
 * Carga datamapping desde una fecha dada (sinceDate) hasta agotar DynamoDB.
 * Crea un pipeline job para que la UI muestre progreso y resultado.
 */
export const datamappingLoadFromDate = inngest.createFunction(
  {
    id: "datamapping-load-from-date",
    name: "Datamapping: cargar desde fecha",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const originalEvent = (
        event as {
          data?: { event?: { data?: { jobId: Id<"pipelineJobs"> } } };
        }
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
  { event: "reconciliation/datamapping.load-from-date" },
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
          message: `Cargando desde ${sinceDate}...`,
        },
      });
      return { ok: true };
    });

    const summary = await step.run("cargar-paginas", async () => {
      let cursor: string | undefined = undefined;
      let totalInserted = 0;
      let totalUpdated = 0;
      let pageIndex = 0;

      while (true) {
        const r = (await client.action(
          api.actions.fetchDatamappingAndIngest,
          { sinceDate, exclusiveStartKey: cursor }
        )) as FetchPageResult;

        totalInserted += r.inserted;
        totalUpdated += r.updated;
        pageIndex += 1;

        await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
          jobId,
          status: "running",
          progress: {
            current: totalInserted + totalUpdated,
            unit: "records",
            message: `Página ${pageIndex}; insertados: ${totalInserted}, actualizados: ${totalUpdated}`,
          },
        });

        if (!r.hasMore) break;
        cursor = r.lastEvaluatedKey;
      }

      return {
        sinceDate,
        pages: pageIndex,
        inserted: totalInserted,
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
