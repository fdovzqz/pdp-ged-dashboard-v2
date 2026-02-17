import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { inngest } from "@/inngest/client";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/**
 * POST /api/datamapping/fecha-transaccion-full
 * Crea un pipeline job y dispara Inngest para llenar fechaTransaccion en datamappingRecords (todos los meses).
 */
export async function POST(): Promise<NextResponse> {
  try {
    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(
      api.pipelineJobs.createPipelineJob,
      {
        jobType: "datamapping_fecha_transaccion_full",
        scope: { mode: "full" },
      }
    )) as Id<"pipelineJobs">;

    await inngest.send({
      name: "reconciliation/datamapping.fecha-transaccion-full",
      data: { jobId },
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[datamapping/fecha-transaccion-full]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Error al iniciar backfill fechaTransaccion",
      },
      { status: 500 }
    );
  }
}
