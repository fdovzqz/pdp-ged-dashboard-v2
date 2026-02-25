import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/**
 * POST /api/datamapping/clear
 * Crea un pipeline job y arranca el motor en Convex para borrar todos los datamappingRecords.
 * La UI consulta pipelineJobs para ver avance.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(
      api.pipelineMutations.createPipelineJob,
      {
        jobType: "datamapping_clear",
        scope: { table: "datamappingRecords" },
      }
    )) as Id<"pipelineJobs">;

    await client.mutation(api.pipelineMutations.startPipelineJob, { jobId });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[datamapping/clear]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Error al iniciar job",
      },
      { status: 500 }
    );
  }
}
