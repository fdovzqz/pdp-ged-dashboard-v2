import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

/**
 * GET /api/test-inngest — Envía un evento de prueba a Inngest.
 * Útil para comprobar que la conexión Inngest funciona sin usar el Dev Server UI.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await inngest.send({
    name: "reconciliation/test.ping",
    data: {
      source: "api",
      ts: Date.now(),
    },
  });

  return NextResponse.json({
    ok: true,
    message: "Evento reconciliation/test.ping enviado a Inngest.",
  });
}
