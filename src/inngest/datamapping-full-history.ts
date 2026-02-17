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

const DATAMAPPING_HISTORY_START = "2024-01";
const PERIOD_END = "2026-02";
const DATAMAPPING_MONTHS = generateMonthRange(
  DATAMAPPING_HISTORY_START,
  PERIOD_END
);

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

type MonthResultOk = {
  ym: string;
  status: "completed";
  inserted: number;
  updated: number;
  maxUpdatedAt: string | null;
};

type MonthResultFailed = {
  ym: string;
  status: "failed";
  error: string;
};

type MonthResult = MonthResultOk | MonthResultFailed;

/**
 * Extrae toda la historia de datamapping (por día, dentro de cada mes).
 * Los 26 meses se ejecutan en paralelo (un step por mes). Si un mes falla, solo ese step se reintenta.
 * Al final el resultado indica: completedMonths (ok), failedMonths (fallaron tras reintentos) para enfocarse en esos.
 * Cada día se procesa por chunks para evitar timeout 524/600s.
 */
export const datamappingFullHistory = inngest.createFunction(
  {
    id: "datamapping-full-history",
    name: "Datamapping: extracción histórica completa",
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
  { event: "reconciliation/datamapping.full-history" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: Id<"pipelineJobs"> };
    const client = new ConvexHttpClient(getConvexUrl());

    await step.run("marcar-running", async () => {
      await client.mutation(api.pipelineJobs.updatePipelineJobProgress, {
        jobId,
        status: "running",
        progress: {
          current: 0,
          total: DATAMAPPING_MONTHS.length,
          unit: "months",
          message: "Procesando 26 meses en paralelo...",
        },
      });
      return { ok: true };
    });

    const monthPromises = DATAMAPPING_MONTHS.map((ym) =>
      step.run(`extraer-mes-${ym}`, async (): Promise<MonthResultOk> => {
        const [y, m] = ym.split("-").map(Number);
        const lastDay = getDaysInMonth(y, m);
        let monthInserted = 0;
        let monthUpdated = 0;
        let monthMaxUpdatedAt: string | null = null;

        for (let day = 1; day <= lastDay; day++) {
          let exclusiveStartKey: string | undefined = undefined;
          let hasMore = true;
          while (hasMore) {
            let res: {
              inserted: number;
              updated: number;
              hasMore: boolean;
              exclusiveStartKey: string | null;
              maxUpdatedAt: string | null;
            };
            try {
              res = (await client.action(
                api.actions.fetchDatamappingForDayChunk,
                { year: y, month: m, day, exclusiveStartKey }
              )) as typeof res;
            } catch (err) {
              throw sanitizeConvexError(err);
            }

            monthInserted += res.inserted;
            monthUpdated += res.updated;
            if (
              res.maxUpdatedAt &&
              (!monthMaxUpdatedAt || res.maxUpdatedAt > monthMaxUpdatedAt)
            ) {
              monthMaxUpdatedAt = res.maxUpdatedAt;
            }
            hasMore = res.hasMore;
            exclusiveStartKey = res.exclusiveStartKey ?? undefined;
          }
        }

        return {
          ym,
          status: "completed",
          inserted: monthInserted,
          updated: monthUpdated,
          maxUpdatedAt: monthMaxUpdatedAt,
        };
      })
    );

    const settled = await Promise.allSettled(monthPromises);
    const results: MonthResult[] = settled.map((outcome, i) => {
      const ym = DATAMAPPING_MONTHS[i];
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const errorMsg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      return { ym, status: "failed" as const, error: errorMsg };
    });

    const completed = results.filter((r): r is MonthResultOk => r.status === "completed");
    const failed = results.filter((r): r is MonthResultFailed => r.status === "failed");

    const maxWatermark = completed.reduce(
      (best, r) =>
        r.maxUpdatedAt && (!best || r.maxUpdatedAt > best)
          ? r.maxUpdatedAt
          : best,
      null as string | null
    );

    await step.run("actualizar-watermark-y-completar", async () => {
      if (maxWatermark) {
        await client.mutation(api.mutations.setDatamappingWatermark, {
          lastUpdatedAt: maxWatermark,
        });
      }

      const totalInserted = completed.reduce((s, r) => s + r.inserted, 0);
      const totalUpdated = completed.reduce((s, r) => s + r.updated, 0);

      const byMonth: Record<
        string,
        { inserted?: number; updated?: number; status: string; error?: string }
      > = {};
      for (const r of results) {
        if (r.status === "completed") {
          byMonth[r.ym] = {
            inserted: r.inserted,
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
          totalInserted,
          totalUpdated,
          byMonth,
          completedMonths,
          failedMonths,
          newWatermark: maxWatermark,
          summary:
            failed.length > 0
              ? `${completed.length} meses ok, ${failed.length} fallaron tras reintentos`
              : "Todos los meses completados",
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
        totalInserted,
        totalUpdated,
        completedMonths,
        failedMonths,
      };
    });

    return { ok: true, jobId };
  }
);
