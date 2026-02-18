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

/** Sanitiza mensajes de error (HTML Cloudflare 500/524 o FUNCTION_INVOCATION_TIMEOUT de Vercel). */
function sanitizeConvexError(err: unknown): Error {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  if (
    msg.includes("FUNCTION_INVOCATION_TIMEOUT") ||
    msg.toLowerCase().includes("function_invocation_timeout")
  ) {
    return new Error(
      "Timeout de Vercel (5 min). El step procesó demasiados datos; los rangos de 3 días evitan este error."
    );
  }
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

/**
 * Días por step para no superar el timeout de Vercel (5 min por invocación).
 * 3 días por step evita FUNCTION_INVOCATION_TIMEOUT incluso en los meses más pesados (p. ej. mayo 2024).
 * Downside: más steps = más invocaciones (Inngest + Vercel); aceptable para runs ocasionales.
 */
const DAYS_PER_STEP = 3;

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Rango de días a procesar en un solo step (evita timeout en meses grandes). */
type RangeTask = { ym: string; startDay: number; endDay: number };

function getMonthRanges(ym: string): RangeTask[] {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = getDaysInMonth(y, m);
  const ranges: RangeTask[] = [];
  for (let start = 1; start <= lastDay; start += DAYS_PER_STEP) {
    const end = Math.min(start + DAYS_PER_STEP - 1, lastDay);
    ranges.push({ ym, startDay: start, endDay: end });
  }
  return ranges;
}

/** Todas las tareas: un step por rango de días (varios por mes). */
const ALL_RANGE_TASKS = DATAMAPPING_MONTHS.flatMap(getMonthRanges);

type RangeResultOk = {
  ym: string;
  startDay: number;
  endDay: number;
  status: "completed";
  inserted: number;
  updated: number;
  maxUpdatedAt: string | null;
};

type RangeResultFailed = {
  ym: string;
  startDay: number;
  endDay: number;
  status: "failed";
  error: string;
};

type RangeResult = RangeResultOk | RangeResultFailed;

/** Resultado agregado por mes (para byMonth y completedMonths / failedMonths). */
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
 * Extrae toda la historia de datamapping por rangos de días (3 días por step).
 * Cada step procesa solo un rango de días para no superar el timeout de Vercel (5 min).
 * Los steps se ejecutan en paralelo; al final se agregan resultados por mes.
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
          message: `Procesando ${ALL_RANGE_TASKS.length} rangos (${DAYS_PER_STEP} días/step) en paralelo...`,
        },
      });
      return { ok: true };
    });

    const rangePromises = ALL_RANGE_TASKS.map(({ ym, startDay, endDay }) =>
      step.run(
        `extraer-${ym}-dias-${startDay}-${endDay}`,
        async (): Promise<RangeResultOk> => {
          const [y, m] = ym.split("-").map(Number);
          let rangeInserted = 0;
          let rangeUpdated = 0;
          let rangeMaxUpdatedAt: string | null = null;

          for (let day = startDay; day <= endDay; day++) {
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

              rangeInserted += res.inserted;
              rangeUpdated += res.updated;
              if (
                res.maxUpdatedAt &&
                (!rangeMaxUpdatedAt || res.maxUpdatedAt > rangeMaxUpdatedAt)
              ) {
                rangeMaxUpdatedAt = res.maxUpdatedAt;
              }
              hasMore = res.hasMore;
              exclusiveStartKey = res.exclusiveStartKey ?? undefined;
            }
          }

          return {
            ym,
            startDay,
            endDay,
            status: "completed",
            inserted: rangeInserted,
            updated: rangeUpdated,
            maxUpdatedAt: rangeMaxUpdatedAt,
          };
        }
      )
    );

    const settled = await Promise.allSettled(rangePromises);
    const rangeResults: RangeResult[] = settled.map((outcome, i) => {
      const task = ALL_RANGE_TASKS[i];
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const errorMsg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      return {
        ym: task.ym,
        startDay: task.startDay,
        endDay: task.endDay,
        status: "failed" as const,
        error: errorMsg,
      };
    });

    // Agregar por mes: un mes está completed solo si todos sus rangos completaron
    const resultsByMonth = new Map<
      string,
      { inserted: number; updated: number; maxUpdatedAt: string | null; failed?: string }
    >();
    for (const ym of DATAMAPPING_MONTHS) {
      resultsByMonth.set(ym, {
        inserted: 0,
        updated: 0,
        maxUpdatedAt: null,
      });
    }
    for (const r of rangeResults) {
      const agg = resultsByMonth.get(r.ym)!;
      if (r.status === "completed") {
        agg.inserted += r.inserted;
        agg.updated += r.updated;
        if (
          r.maxUpdatedAt &&
          (!agg.maxUpdatedAt || r.maxUpdatedAt > agg.maxUpdatedAt)
        ) {
          agg.maxUpdatedAt = r.maxUpdatedAt;
        }
      } else {
        agg.failed = (agg.failed ? agg.failed + "; " : "") + `días ${r.startDay}-${r.endDay}: ${r.error}`;
      }
    }

    const completed: MonthResultOk[] = [];
    const failed: MonthResultFailed[] = [];
    for (const ym of DATAMAPPING_MONTHS) {
      const agg = resultsByMonth.get(ym)!;
      if (agg.failed) {
        failed.push({ ym, status: "failed", error: agg.failed });
      } else {
        completed.push({
          ym,
          status: "completed",
          inserted: agg.inserted,
          updated: agg.updated,
          maxUpdatedAt: agg.maxUpdatedAt,
        });
      }
    }
    const results: MonthResult[] = [...completed, ...failed];

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
