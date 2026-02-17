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
