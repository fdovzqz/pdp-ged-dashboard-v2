import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

function generateMonthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

const DATAMAPPING_HISTORY_START = "2024-01";
const PERIOD_END = "2026-02";

/**
 * POST /api/datamapping/enrich-by-months
 * Crea un pipeline job datamapping_enrichment_by_months y lo arranca.
 * Body: { months?: string[] } o { start?: "YYYY-MM", end?: "YYYY-MM" }.
 * Si no se envía body, usa todo el rango por defecto.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      months?: string[];
      start?: string;
      end?: string;
    };

    let months: string[];
    if (Array.isArray(body.months) && body.months.length > 0) {
      months = body.months;
    } else if (
      typeof body.start === "string" &&
      typeof body.end === "string"
    ) {
      months = generateMonthRange(body.start, body.end);
    } else {
      months = generateMonthRange(DATAMAPPING_HISTORY_START, PERIOD_END);
    }

    if (months.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Rango de meses inválido o vacío" },
        { status: 400 }
      );
    }

    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(
      api.pipelineMutations.createPipelineJob,
      {
        jobType: "datamapping_enrichment_by_months",
        scope: { months },
      }
    )) as Id<"pipelineJobs">;

    await client.mutation(api.pipelineMutations.startPipelineJob, {
      jobId,
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[datamapping/enrich-by-months]", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error al iniciar enriquecimiento por meses",
      },
      { status: 500 }
    );
  }
}
