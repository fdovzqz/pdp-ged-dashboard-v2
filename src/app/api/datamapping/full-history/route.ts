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

const DATAMAPPING_HISTORY_START = "2024-01";
const PERIOD_END = "2026-02";
const DATAMAPPING_MONTHS = generateMonthRange(
  DATAMAPPING_HISTORY_START,
  PERIOD_END
);

/**
 * POST /api/datamapping/full-history
 * Crea un pipeline job y dispara Inngest para extraer toda la historia de datamapping.
 * El job corre en Inngest (independiente de la UI). La UI consulta pipelineJobs para ver avance.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(
      api.pipelineJobs.createPipelineJob,
      {
        jobType: "datamapping_full_history",
        scope: { months: DATAMAPPING_MONTHS },
      }
    )) as Id<"pipelineJobs">;

    await inngest.send({
      name: "reconciliation/datamapping.full-history",
      data: { jobId },
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[datamapping/full-history]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Error al iniciar job",
      },
      { status: 500 }
    );
  }
}
