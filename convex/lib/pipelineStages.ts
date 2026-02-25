/**
 * Standard ETL pipeline stages. All workflows compose a subset of these in order.
 * Engine uses these for observability and quality gates placement.
 */
export const PIPELINE_STAGES = [
  "scan",
  "extract",
  "clean",
  "dedup",
  "reconcile",
  "enrich",
  "aggregate",
  "publish",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Maps each jobType to the primary pipeline stages it executes (for observability and quality hooks). */
export const JOB_TYPE_STAGES: Record<string, PipelineStage[]> = {
  datamapping_full_history: ["extract", "clean", "dedup"],
  datamapping_clear: ["extract"],
  datamapping_enrichment_by_months: ["enrich"],
  datamapping_backfill_enrichment_by_months: ["clean", "enrich"],
  datamapping_load_from_date: ["extract", "clean", "dedup"],
  datamapping_fecha_transaccion_full: ["clean", "enrich"],
  datamapping_fecha_transaccion_from_date: ["clean", "enrich"],
  datamapping_incremental: ["extract", "clean", "dedup"],
  datamapping_sync_by_months: ["extract", "clean", "dedup"],
  datamapping_sync_by_range: ["extract", "clean", "dedup"],
  cloudwatch_incremental: ["extract", "clean", "dedup"],
  cloudwatch_sync_by_months: ["extract", "clean", "dedup"],
  cloudwatch_sync_by_range: ["extract", "clean", "dedup"],
  cloudwatch_clear: ["extract"],
};

export function getStagesForJobType(jobType: string): PipelineStage[] {
  return JOB_TYPE_STAGES[jobType] ?? ["extract"];
}
