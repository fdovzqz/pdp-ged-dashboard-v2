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

const PERIOD_START = "2024-01";
const PERIOD_END = "2026-02";

/**
 * POST /api/cloudwatch/clear
 * Body opcional: { month?: "YYYY-MM" } para borrar solo un mes; sin body borra todo el período.
 * Crea un pipeline job que borra paymentRecords, monthStats y la marca de agua CloudWatch.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let months: string[];
    const body = (await request.json().catch(() => ({}))) as {
      month?: string;
    };
    if (
      typeof body.month === "string" &&
      /^\d{4}-\d{2}$/.test(body.month.trim())
    ) {
      months = [body.month.trim()];
    } else {
      months = generateMonthRange(PERIOD_START, PERIOD_END);
    }

    if (months.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No hay meses que borrar" },
        { status: 400 }
      );
    }

    const client = new ConvexHttpClient(getConvexUrl());
    const jobId = (await client.mutation(api.pipelineMutations.createPipelineJob, {
      jobType: "cloudwatch_clear",
      scope: { months },
    })) as Id<"pipelineJobs">;

    await client.mutation(api.pipelineMutations.startPipelineJob, {
      jobId,
    });

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    console.error("[cloudwatch/clear]", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Error al iniciar job de borrado",
      },
      { status: 500 }
    );
  }
}
