import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

/** POST: dispara extracción incremental (marca de agua) vía Inngest. Cron cada 5 min también. */
export async function POST(): Promise<NextResponse> {
  try {
    await inngest.send({
      name: "reconciliation/datamapping.incremental",
      data: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[datamapping/incremental]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error" },
      { status: 500 }
    );
  }
}
