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
 * POST /api/datamapping/fecha-transaccion-full
 * Body (optional): { startDate?: string, endDate?: string } (YYYY-MM-DD)
 * - Si se envían startDate y endDate, solo se generan bloques de 3 días en ese rango (para reintentar periodos fallidos).
 * - Si no, se ejecuta sobre todos los meses por defecto.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let scope: { mode: string; startDate?: string; endDate?: string; months?: string[] } = {
      mode: "full",
    };
    const contentType = request.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const body = (await request.json()) as { startDate?: string; endDate?: string };
      if (
        body.startDate != null &&
        body.endDate != null &&
        String(body.startDate).trim().length >= 10 &&
        String(body.endDate).trim().length >= 10
      ) {
        scope = {
          mode: "full",
          startDate: String(body.startDate).slice(0, 10),
          endDate: String(body.endDate).slice(0, 10),
        };
      }
    }

    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(
      api.pipelineMutations.createPipelineJob,
      {
        jobType: "datamapping_fecha_transaccion_full",
        scope,
      }
    )) as Id<"pipelineJobs">;

    await client.mutation(api.pipelineMutations.startPipelineJob, { jobId });

    return NextResponse.json({
      ok: true,
      jobId,
      ...(scope.startDate && scope.endDate
        ? { range: `${scope.startDate} a ${scope.endDate}` }
        : {}),
    });
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
