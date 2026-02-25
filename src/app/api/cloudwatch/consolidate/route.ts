import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/**
 * POST /api/cloudwatch/consolidate
 * Body: { fromDate: "YYYY-MM-DD", toDate: "YYYY-MM-DD" }
 * Lee tablas cloudwatchSourceV1/V2/Payment en ese rango, aplica prioridad por referencia y escribe en paymentRecords.
 * Ejecutar después de un sync determinístico para actualizar paymentRecords desde las tablas fuente.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      fromDate?: string;
      toDate?: string;
    };
    const fromDate = body.fromDate?.slice(0, 10);
    const toDate = body.toDate?.slice(0, 10);
    if (!fromDate || !toDate || fromDate > toDate) {
      return NextResponse.json(
        { ok: false, error: "fromDate y toDate (YYYY-MM-DD) requeridos y fromDate <= toDate" },
        { status: 400 }
      );
    }

    const client = new ConvexHttpClient(getConvexUrl());
    await client.mutation(api.cloudwatchMutations.scheduleConsolidationFromSourceTables, {
      fromDate,
      toDate,
    });

    return NextResponse.json({
      ok: true,
      fromDate,
      toDate,
      message: "Consolidación programada (tablas fuente → paymentRecords)",
    });
  } catch (err) {
    console.error("[cloudwatch/consolidate]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Error al programar consolidación",
      },
      { status: 500 }
    );
  }
}
