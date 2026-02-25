import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/** Valida formato YYYY-MM-DD. */
function isValidDate(s: string): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

/**
 * POST /api/datamapping/fecha-transaccion-from-date
 * Body: { sinceDate: "YYYY-MM-DD" }
 * Crea un pipeline job y arranca el motor en Convex para llenar fechaTransaccion desde esa fecha.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { sinceDate?: string };
    const sinceDate = body?.sinceDate;
    if (typeof sinceDate !== "string" || !sinceDate.trim()) {
      return NextResponse.json(
        { ok: false, error: "Falta sinceDate (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const trimmed = sinceDate.trim();
    if (!isValidDate(trimmed)) {
      return NextResponse.json(
        { ok: false, error: "sinceDate debe ser YYYY-MM-DD válido" },
        { status: 400 }
      );
    }

    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(
      api.pipelineMutations.createPipelineJob,
      {
        jobType: "datamapping_fecha_transaccion_from_date",
        scope: { sinceDate: trimmed },
      }
    )) as Id<"pipelineJobs">;

    await client.mutation(api.pipelineMutations.startPipelineJob, { jobId });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[datamapping/fecha-transaccion-from-date]", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Error al iniciar backfill fechaTransaccion",
      },
      { status: 500 }
    );
  }
}
