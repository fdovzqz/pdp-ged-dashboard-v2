import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/** POST: crea un pipeline job y arranca extracción incremental (marca de agua) en Convex. */
export async function POST(): Promise<NextResponse> {
  try {
    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(api.pipelineMutations.createPipelineJob, {
      jobType: "datamapping_incremental",
      scope: {},
    })) as Id<"pipelineJobs">;

    await client.mutation(api.pipelineMutations.startPipelineJob, { jobId });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[datamapping/incremental]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error" },
      { status: 500 }
    );
  }
}
