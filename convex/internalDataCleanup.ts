/**
 * Limpieza interna de tablas de datos para preparar pruebas integrales.
 * Solo accesible desde otras funciones Convex o CLI: npx convex run internalDataCleanup:prepareForIntegralTesting
 *
 * Orden: reconciliación → pipeline (audit, units, jobs) → ETL (rfc*, datamapping stats/records, processingControl)
 *       → CloudWatch (watermark, paymentRecords por mes, monthStats) → agregados CW/DM por mes.
 */

import { internalAction, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";

const BATCH = 300;

/** Borra un lote de auditEvents. Devuelve cuántos se borraron. */
export const clearBatchAuditEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("auditEvents").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Borra un lote de pipelineJobUnits. */
export const clearBatchPipelineJobUnits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("pipelineJobUnits").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Borra un lote de pipelineJobs. */
export const clearBatchPipelineJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("pipelineJobs").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Borra un lote de rfcInvestigationResults. */
export const clearBatchRfcInvestigationResults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("rfcInvestigationResults").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Borra un lote de rfcEnrichmentRuns. */
export const clearBatchRfcEnrichmentRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("rfcEnrichmentRuns").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Borra todos los documentos de processingControl (watermarks, etc.). */
export const clearProcessingControlAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("processingControl").collect();
    for (const d of all) await ctx.db.delete(d._id);
    return all.length;
  },
});

/** Borra un lote de datamappingMonthStats. */
export const clearBatchDatamappingMonthStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("datamappingMonthStats").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Borra un lote de datamappingRecords. */
export const clearBatchDatamappingRecords = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("datamappingRecords").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Borra un lote de monthStats. */
export const clearBatchMonthStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batch = await ctx.db.query("monthStats").take(BATCH);
    for (const d of batch) await ctx.db.delete(d._id);
    return batch.length;
  },
});

/** Ejecuta la limpieza completa en orden. Obtiene meses de monthStats al inicio para usarlos después. */
export const prepareForIntegralTesting = internalAction({
  args: {},
  handler: async (ctx) => {
    const out: string[] = [];

    const monthsList = (await ctx.runQuery(api.cloudwatchQueries.getAllMonthsStatus, {})) as { month: string }[];
    const months = monthsList.map((m) => m.month);

    while (true) {
      const res = (await ctx.runMutation(api.reconciliationMutations.clearReconciliationBatch, {})) as { deleted: number };
      if (res.deleted === 0) break;
      out.push(`reconciliation: ${res.deleted}`);
    }
    out.push("reconciliation: done");

    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchAuditEvents, {});
      if (n === 0) break;
      out.push(`auditEvents: ${n}`);
    }
    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchPipelineJobUnits, {});
      if (n === 0) break;
      out.push(`pipelineJobUnits: ${n}`);
    }
    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchPipelineJobs, {});
      if (n === 0) break;
      out.push(`pipelineJobs: ${n}`);
    }
    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchRfcInvestigationResults, {});
      if (n === 0) break;
      out.push(`rfcInvestigationResults: ${n}`);
    }
    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchRfcEnrichmentRuns, {});
      if (n === 0) break;
      out.push(`rfcEnrichmentRuns: ${n}`);
    }

    await ctx.runMutation(api.datamappingMutations.clearDatamappingIngestionStats, {});
    out.push("datamappingIngestionStats: cleared");

    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchDatamappingMonthStats, {});
      if (n === 0) break;
      out.push(`datamappingMonthStats: ${n}`);
    }
    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchDatamappingRecords, {});
      if (n === 0) break;
      out.push(`datamappingRecords: ${n}`);
    }

    await ctx.runMutation(api.datamappingMutations.clearDatamappingWatermark, {});
    await ctx.runMutation(api.cloudwatchMutations.clearCloudwatchWatermark, {});
    out.push("watermarks: cleared");

    const pc = await ctx.runMutation(internal.internalDataCleanup.clearProcessingControlAll, {}) as number;
    out.push(`processingControl: ${pc}`);

    for (const month of months) {
      let total = 0;
      while (true) {
        const res = (await ctx.runMutation(api.cloudwatchMutations.deletePaymentsByMonth, { month })) as { deleted: number };
        if (res.deleted === 0) break;
        total += res.deleted;
      }
      if (total > 0) out.push(`paymentRecords ${month}: ${total}`);
    }
    out.push("paymentRecords: done");

    while (true) {
      const n = await ctx.runMutation(internal.internalDataCleanup.clearBatchMonthStats, {});
      if (n === 0) break;
      out.push(`monthStats: ${n}`);
    }

    for (const monthStr of months) {
      const [y, m] = monthStr.split("-").map(Number);
      await ctx.runMutation(api.aggregatesCloudwatchMutations.clearAggregatesForMonth, { year: y, month: m });
      await ctx.runMutation(api.datamappingMutations.clearDatamappingAggregatesForMonth, { year: y, month: m });
    }
    out.push(`aggregates: cleared for ${months.length} months`);

    return { ok: true, steps: out };
  },
});
