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

const ENRICHMENT_START = "2024-01";
const ENRICHMENT_END = "2026-02";
const ENRICHMENT_MONTHS = generateMonthRange(ENRICHMENT_START, ENRICHMENT_END);

type EnrichmentMonthResultOk = {
  ym: string;
  status: "completed";
  processed: number;
  enriched: number;
};

type EnrichmentMonthResultFailed = {
  ym: string;
  status: "failed";
  error: string;
};

type EnrichmentMonthResult = EnrichmentMonthResultOk | EnrichmentMonthResultFailed;

/**
 * Enriquecimiento de datamapping por meses en paralelo (RFC + placa, evoId, etc.).
 * Un step por mes; dentro de cada step, bucle con continueState hasta isDone.
 * Resultado en pipelineJobs: completedMonths, failedMonths, byMonth.
 */
export const datamappingEnrichmentByMonths = inngest.createFunction(
  {
    id: "datamapping-enrichment-by-months",
    name: "Datamapping: enriquecimiento por meses",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const originalEvent = (event as { data?: { event?: { data?: { jobId: Id<"pipelineJobs"> } } } }).data?.event?.data;
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
  { event: "reconciliation/datamapping.enrich-by-months" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: Id<"pipelineJobs"> };
    const client = new ConvexHttpClient(getConvexUrl());

    await step.run("marcar-running", async () => {
      await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
        jobId,
        status: "running",
        progress: {
          current: 0,
          total: ENRICHMENT_MONTHS.length,
          unit: "months",
          message: `Enriqueciendo ${ENRICHMENT_MONTHS.length} meses en paralelo...`,
        },
      });
      return { ok: true };
    });

    const monthPromises = ENRICHMENT_MONTHS.map((ym) =>
      step.run(`enriquecer-mes-${ym}`, async (): Promise<EnrichmentMonthResultOk> => {
        const [y, m] = ym.split("-").map(Number);
        const fromDate = `${ym}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const toDate = `${ym}-${String(lastDay).padStart(2, "0")}`;

        let processed = 0;
        let enriched = 0;
        let continueState:
          | { cursor: string | null; updatedAtFrom: string; updatedAtTo: string }
          | undefined;

        do {
          let result: {
            processed: number;
            enriched: number;
            isDone: boolean;
            continueState?: { cursor: string | null; updatedAtFrom: string; updatedAtTo: string };
          };
          try {
            result = (await client.action(api.actions.enrichDatamappingWithRfc, {
              fromDate,
              toDate,
              continueState,
              maxDurationMs: 85_000,
            })) as typeof result;
          } catch (err) {
            throw sanitizeConvexError(err);
          }

          processed += result.processed;
          enriched += result.enriched;
          continueState = result.continueState;
          if (result.isDone) break;
        } while (continueState);

        return {
          ym,
          status: "completed",
          processed,
          enriched,
        };
      })
    );

    const settled = await Promise.allSettled(monthPromises);
    const results: EnrichmentMonthResult[] = settled.map((outcome, i) => {
      const ym = ENRICHMENT_MONTHS[i];
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const errorMsg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      return { ym, status: "failed" as const, error: errorMsg };
    });

    const completed = results.filter((r): r is EnrichmentMonthResultOk => r.status === "completed");
    const failed = results.filter((r): r is EnrichmentMonthResultFailed => r.status === "failed");

    await step.run("actualizar-resultado-y-completar", async () => {
      const totalProcessed = completed.reduce((s, r) => s + r.processed, 0);
      const totalEnriched = completed.reduce((s, r) => s + r.enriched, 0);

      const byMonth: Record<
        string,
        { processed?: number; enriched?: number; status: string; error?: string }
      > = {};
      for (const r of results) {
        if (r.status === "completed") {
          byMonth[r.ym] = {
            processed: r.processed,
            enriched: r.enriched,
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
          totalEnriched,
          byMonth,
          completedMonths,
          failedMonths,
          summary:
            failed.length > 0
              ? `${completed.length} meses ok, ${failed.length} fallaron tras reintentos`
              : "Todos los meses de enriquecimiento completados",
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
        totalEnriched,
        completedMonths,
        failedMonths,
      };
    });

    return { ok: true, jobId };
  }
);
