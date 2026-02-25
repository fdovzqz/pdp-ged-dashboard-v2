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

const CLOUDWATCH_DEFAULT_START = "2024-01";
const CLOUDWATCH_DEFAULT_END = "2026-02";

/**
 * POST /api/cloudwatch/sync-by-months
 * Body: { startDate?: "YYYY-MM-DD", endDate?: "YYYY-MM-DD" } → job por rango (unidad por día).
 * Body alternativo: { months?: string[] } o { start?: "YYYY-MM", end?: "YYYY-MM" } → job por meses.
 * Body.deterministic?: true → usa conteo por hora + tablas fuente (cloudwatchSourceV1/V2/Payment) y verificación; no escribe en paymentRecords hasta ejecutar consolidación aparte.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      months?: string[];
      start?: string;
      end?: string;
      startDate?: string;
      endDate?: string;
      deterministic?: boolean;
    };

    const client = new ConvexHttpClient(getConvexUrl());
    const deterministic = Boolean(body.deterministic);

    if (
      typeof body.startDate === "string" &&
      typeof body.endDate === "string" &&
      body.startDate.length >= 10 &&
      body.endDate.length >= 10
    ) {
      const startDate = body.startDate.slice(0, 10);
      const endDate = body.endDate.slice(0, 10);
      if (startDate > endDate) {
        return NextResponse.json(
          { ok: false, error: "Fecha inicio debe ser anterior o igual a fecha fin" },
          { status: 400 }
        );
      }
      const jobType = deterministic
        ? "cloudwatch_deterministic_sync_by_range"
        : "cloudwatch_sync_by_range";
      const jobId = (await client.mutation(
        api.pipelineMutations.createPipelineJob,
        {
          jobType,
          scope: { startDate, endDate },
        }
      )) as Id<"pipelineJobs">;
      await client.mutation(api.pipelineMutations.startPipelineJob, {
        jobId,
      });
      return NextResponse.json({ ok: true, jobId, deterministic });
    }

    let months: string[];
    if (Array.isArray(body.months) && body.months.length > 0) {
      months = body.months;
    } else if (
      typeof body.start === "string" &&
      typeof body.end === "string"
    ) {
      months = generateMonthRange(body.start, body.end);
    } else {
      months = generateMonthRange(CLOUDWATCH_DEFAULT_START, CLOUDWATCH_DEFAULT_END);
    }

    if (months.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Rango de meses inválido o vacío" },
        { status: 400 }
      );
    }

    const jobType = deterministic
      ? "cloudwatch_deterministic_sync_by_months"
      : "cloudwatch_sync_by_months";
    const jobId = (await client.mutation(
      api.pipelineMutations.createPipelineJob,
      {
        jobType,
        scope: { months },
      }
    )) as Id<"pipelineJobs">;

    await client.mutation(api.pipelineMutations.startPipelineJob, {
      jobId,
    });

    return NextResponse.json({ ok: true, jobId, deterministic });
  } catch (err) {
    console.error("[cloudwatch/sync-by-months]", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Error al iniciar extracción CloudWatch",
      },
      { status: 500 }
    );
  }
}
