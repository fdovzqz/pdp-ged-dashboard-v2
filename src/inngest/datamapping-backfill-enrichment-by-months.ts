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

const BACKFILL_START = "2024-01";
const BACKFILL_END = "2026-02";
const BACKFILL_MONTHS = generateMonthRange(BACKFILL_START, BACKFILL_END);

function monthToUpdatedAtRange(ym: string): { updatedAtFrom: string; updatedAtTo: string } {
  const [y, m] = ym.split("-").map(Number);
  const updatedAtFrom = `${ym}-01T00:00:00.000Z`;
  const nextMonth = m === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
  const updatedAtTo = nextMonth.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  return { updatedAtFrom, updatedAtTo };
}

type BackfillMonthResultOk = {
  ym: string;
  status: "completed";
  patched: number;
};

type BackfillMonthResultFailed = {
  ym: string;
  status: "failed";
  error: string;
};

type BackfillMonthResult = BackfillMonthResultOk | BackfillMonthResultFailed;

/**
 * Backfill de enrichmentExtracted (y borrado de rfcExtracted) por meses en paralelo.
 * Un step por mes; dentro de cada step, bucle con cursor hasta isDone.
 * ~900k registros repartidos por meses; termina en minutos.
 */
export const datamappingBackfillEnrichmentByMonths = inngest.createFunction(
  {
    id: "datamapping-backfill-enrichment-by-months",
    name: "Datamapping: backfill enrichmentExtracted por meses",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const originalEvent = (event as { data?: { event?: { data?: { jobId: Id<"pipelineJobs"> } } } })
        .data?.event?.data;
      const jobId = originalEvent?.jobId;
      if (!jobId) return;
      const client = new ConvexHttpClient(getConvexUrl());
      await client.mutation(api.pipelineJobs.updatePipelineJobError, {
        jobId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    },
  },
  { event: "reconciliation/datamapping.backfill-enrichment-by-months" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: Id<"pipelineJobs"> };
    const client = new ConvexHttpClient(getConvexUrl());

    await step.run("marcar-running", async () => {
      await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
        jobId,
        status: "running",
        progress: {
          current: 0,
          total: BACKFILL_MONTHS.length,
          unit: "months",
          message: `Backfill enrichmentExtracted (${BACKFILL_MONTHS.length} meses en paralelo)...`,
        },
      });
      return { ok: true };
    });

    const monthPromises = BACKFILL_MONTHS.map((ym) =>
      step.run(`backfill-mes-${ym}`, async (): Promise<BackfillMonthResultOk> => {
        const { updatedAtFrom, updatedAtTo } = monthToUpdatedAtRange(ym);
        let patched = 0;
        let cursor: string | null = null;

        do {
          let result: {
            total: number;
            cursor: string | null;
            timedOut: boolean;
            isDone: boolean;
          };
          try {
            result = (await client.action(
              api.actions.backfillDatamappingEnrichmentExtractedForRange,
              {
                updatedAtFrom,
                updatedAtTo,
                cursor: cursor ?? undefined,
                maxDurationMs: 85_000,
              }
            )) as typeof result;
          } catch (err) {
            throw sanitizeConvexError(err);
          }

          patched += result.total;
          cursor = result.cursor;
          if (result.isDone) break;
        } while (cursor);

        return { ym, status: "completed", patched };
      })
    );

    const settled = await Promise.allSettled(monthPromises);
    const results: BackfillMonthResult[] = settled.map((outcome, i) => {
      const ym = BACKFILL_MONTHS[i];
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
      (r): r is BackfillMonthResultOk => r.status === "completed"
    );
    const failed = results.filter(
      (r): r is BackfillMonthResultFailed => r.status === "failed"
    );

    await step.run("actualizar-resultado-y-completar", async () => {
      const totalPatched = completed.reduce((s, r) => s + r.patched, 0);
      const byMonth: Record<
        string,
        { patched?: number; status: string; error?: string }
      > = {};
      for (const r of results) {
        if (r.status === "completed") {
          byMonth[r.ym] = { patched: r.patched, status: "completed" };
        } else {
          byMonth[r.ym] = { status: "failed", error: r.error };
        }
      }

      await client.mutation(api.pipelineJobs.updatePipelineJobResult, {
        jobId,
        result: {
          totalPatched,
          byMonth,
          completedMonths: completed.map((r) => r.ym),
          failedMonths: failed.map((r) => ({ ym: r.ym, error: r.error })),
          summary:
            failed.length > 0
              ? `${completed.length} meses ok, ${failed.length} fallaron`
              : `Backfill completado: ${totalPatched} registros actualizados`,
        },
      });

      if (failed.length > 0) {
        await client.mutation(api.pipelineJobs.updatePipelineJobError, {
          jobId,
          errorMessage: `Meses fallidos (${failed.length}): ${failed.map((r) => r.ym).join(", ")}. Revisar result.failedMonths.`,
        });
      }

      return {
        ok: true,
        totalPatched,
        completedMonths: completed.map((r) => r.ym),
        failedMonths: failed.map((r) => r.ym),
      };
    });

    return { ok: true, jobId };
  }
);
