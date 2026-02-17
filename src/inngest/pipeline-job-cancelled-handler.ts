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
 * Cuando se cancela un run de Inngest (UI, API o cancelOn), Inngest emite
 * inngest/function.cancelled. Esta función actualiza el pipelineJob en Convex
 * a status "cancelled" para que la UI muestre el estado correcto.
 */
export const pipelineJobCancelledHandler = inngest.createFunction(
  {
    id: "pipeline-job-cancelled-handler",
    name: "Actualizar pipelineJob cuando Inngest cancela un run",
  },
  {
    event: "inngest/function.cancelled",
    if: "event.data.function_id == 'reconciliation-datamapping-full-history' || event.data.function_id == 'reconciliation-datamapping-clear'",
  },
  async ({ event }) => {
    const data = event.data as {
      function_id?: string;
      event?: { data?: { jobId?: string } };
    };
    const jobId = data.event?.data?.jobId;
    if (!jobId) return { ok: false, reason: "no jobId in event" };

    const client = new ConvexHttpClient(getConvexUrl());
    await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
      jobId: jobId as Id<"pipelineJobs">,
      status: "cancelled",
    });

    return { ok: true, jobId };
  }
);
