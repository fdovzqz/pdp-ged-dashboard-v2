"use node";

import { inngest } from "./client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/** Sanitiza mensajes de error que son HTML (Cloudflare 500/524). */
function sanitizeConvexError(err: unknown): Error {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  if (
    msg.startsWith("<") ||
    msg.includes("<!DOCTYPE") ||
    msg.includes("<html")
  ) {
    if (
      msg.includes("524") ||
      msg.toLowerCase().includes("timeout") ||
      msg.includes("A timeout occurred")
    ) {
      return new Error(
        "Timeout: el servidor tardó demasiado en responder (524). Intenta de nuevo."
      );
    }
    if (
      msg.includes("500") ||
      msg.includes("Internal server error") ||
      msg.includes("Error code 500")
    ) {
      return new Error(
        "Error interno del servidor (500). Intenta de nuevo en unos minutos."
      );
    }
    return new Error("Error del servidor. Intenta de nuevo.");
  }
  return err instanceof Error ? err : new Error(msg);
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

const FECHA_TRANSACCION_START = "2024-01";
const FECHA_TRANSACCION_END = "2026-02";
const FECHA_TRANSACCION_MONTHS = generateMonthRange(
  FECHA_TRANSACCION_START,
  FECHA_TRANSACCION_END
);

type MonthResultOk = {
  ym: string;
  status: "completed";
  processed: number;
  updated: number;
};

type MonthResultFailed = {
  ym: string;
  status: "failed";
  error: string;
};

type MonthResult = MonthResultOk | MonthResultFailed;

/**
 * Backfill fechaTransaccion por meses en paralelo.
 * Un step por mes; dentro de cada step, bucle con continueState hasta isDone.
 * Resultado en pipelineJobs: completedMonths, failedMonths, byMonth.
 */
export const datamappingFechaTransaccionFull = inngest.createFunction(
  {
    id: "datamapping-fecha-transaccion-full",
    name: "Datamapping: llenar fechaTransaccion (completo)",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const originalEvent = (
        event as { data?: { event?: { data?: { jobId: Id<"pipelineJobs"> } } } }
      ).data?.event?.data;
      const jobId = originalEvent?.jobId;
      if (!jobId) return;
      const client = new ConvexHttpClient(getConvexUrl());
      await client.mutation(api.pipelineJobs.updatePipelineJobError, {
        jobId,
        errorMessage:
          error instanceof Error ? error.message : String(error),
      });
    },
  },
  { event: "reconciliation/datamapping.fecha-transaccion-full" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: Id<"pipelineJobs"> };
    const client = new ConvexHttpClient(getConvexUrl());

    await step.run("marcar-running", async () => {
      await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
        jobId,
        status: "running",
        progress: {
          current: 0,
          total: FECHA_TRANSACCION_MONTHS.length,
          unit: "months",
          message: `Llenando fechaTransaccion en ${FECHA_TRANSACCION_MONTHS.length} meses...`,
        },
      });
      return { ok: true };
    });

    const monthPromises = FECHA_TRANSACCION_MONTHS.map((ym) =>
      step.run(`llenar-mes-${ym}`, async (): Promise<MonthResultOk> => {
        const [y, m] = ym.split("-").map(Number);

        let processed = 0;
        let updated = 0;
        let continueState: { cursor: string | null } | undefined;

        do {
          let result: {
            processed: number;
            updated: number;
            isDone: boolean;
            continueState?: { cursor: string | null };
          };
          try {
            result = (await client.action(
              api.actions.backfillFechaTransaccionForMonth,
              { year: y, month: m, continueState, maxDurationMs: 85_000 }
            )) as typeof result;
          } catch (err) {
            throw sanitizeConvexError(err);
          }

          processed += result.processed;
          updated += result.updated;
          continueState = result.continueState;
          if (result.isDone) break;
        } while (continueState);

        return {
          ym,
          status: "completed",
          processed,
          updated,
        };
      })
    );

    const settled = await Promise.allSettled(monthPromises);
    const results: MonthResult[] = settled.map((outcome, i) => {
      const ym = FECHA_TRANSACCION_MONTHS[i];
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const errorMsg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      return { ym, status: "failed" as const, error: errorMsg };
    });

    const completed = results.filter(
      (r): r is MonthResultOk => r.status === "completed"
    );
    const failed = results.filter(
      (r): r is MonthResultFailed => r.status === "failed"
    );

    await step.run("actualizar-resultado-y-completar", async () => {
      const totalProcessed = completed.reduce((s, r) => s + r.processed, 0);
      const totalUpdated = completed.reduce((s, r) => s + r.updated, 0);

      const byMonth: Record<
        string,
        { processed?: number; updated?: number; status: string; error?: string }
      > = {};
      for (const r of results) {
        if (r.status === "completed") {
          byMonth[r.ym] = {
            processed: r.processed,
            updated: r.updated,
            status: "completed",
          };
        } else {
          byMonth[r.ym] = { status: "failed", error: r.error };
        }
      }

      const completedMonths = completed.map((r) => r.ym);
      const failedMonths = failed.map((r) => ({ ym: r.ym, error: r.error }));

      await client.mutation(api.pipelineJobs.updatePipelineJobResult, {
        jobId,
        result: {
          totalProcessed,
          totalUpdated,
          byMonth,
          completedMonths,
          failedMonths,
          summary:
            failed.length > 0
              ? `${completed.length} meses ok, ${failed.length} fallaron tras reintentos`
              : "Todos los meses de fechaTransaccion completados",
        },
      });

      if (failed.length > 0) {
        await client.mutation(api.pipelineJobs.updatePipelineJobError, {
          jobId,
          errorMessage: `Meses fallidos (${failed.length}): ${failed.map((r) => r.ym).join(", ")}. Revisar result.failedMonths para detalles.`,
        });
      }

      return {
        ok: true,
        totalProcessed,
        totalUpdated,
        completedMonths,
        failedMonths,
      };
    });

    return { ok: true, jobId };
  }
);
