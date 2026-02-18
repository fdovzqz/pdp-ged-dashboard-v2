import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { testPing } from "@/inngest/functions";
import { datamappingFullHistory } from "@/inngest/datamapping-full-history";
import { datamappingEnrichmentByMonths } from "@/inngest/datamapping-enrichment-by-months";
import { datamappingBackfillEnrichmentByMonths } from "@/inngest/datamapping-backfill-enrichment-by-months";
import { datamappingClear } from "@/inngest/datamapping-clear";
import { datamappingIncremental } from "@/inngest/datamapping-incremental";
import { datamappingLoadFromDate } from "@/inngest/datamapping-load-from-date";
import { datamappingFechaTransaccionFull } from "@/inngest/datamapping-fecha-transaccion-full";
import { datamappingFechaTransaccionFromDate } from "@/inngest/datamapping-fecha-transaccion-from-date";
import { pipelineJobCancelledHandler } from "@/inngest/pipeline-job-cancelled-handler";

/**
 * Límite de ejecución por invocación en Vercel (segundos).
 * Por defecto Vercel usa 300s (5 min); en plan Pro se puede subir hasta 800.
 * Los steps pesados (p. ej. meses grandes en datamapping full-history) subdividen
 * por rangos de días para no superar este límite.
 */
export const maxDuration = 300;

/**
 * Ruta requerida por Inngest para registrar funciones e invocarlas.
 * GET: descubrimiento de la app por el Inngest Dev Server.
 * POST/PUT: ejecución de funciones.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    testPing,
    datamappingFullHistory,
    datamappingEnrichmentByMonths,
    datamappingBackfillEnrichmentByMonths,
    datamappingClear,
    datamappingIncremental,
    datamappingLoadFromDate,
    datamappingFechaTransaccionFull,
    datamappingFechaTransaccionFromDate,
    pipelineJobCancelledHandler,
  ],
});
