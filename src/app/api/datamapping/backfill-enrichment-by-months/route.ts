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

const BACKFILL_START = "2024-01";
const BACKFILL_END = "2026-02";
const BACKFILL_MONTHS = generateMonthRange(BACKFILL_START, BACKFILL_END);

/**
 * POST /api/datamapping/backfill-enrichment-by-months
 * Crea un pipeline job y dispara Inngest para backfill de enrichmentExtracted (y borrado de rfcExtracted) por meses en paralelo.
 * ~900k registros; termina en minutos en lugar de horas.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(
      api.pipelineJobs.createPipelineJob,
      {
        jobType: "datamapping_backfill_enrichment_by_months",
        scope: { months: BACKFILL_MONTHS },
      }
    )) as Id<"pipelineJobs">;

    await inngest.send({
      name: "reconciliation/datamapping.backfill-enrichment-by-months",
      data: { jobId },
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[datamapping/backfill-enrichment-by-months]", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error al iniciar job de backfill",
      },
      { status: 500 }
    );
  }
}
