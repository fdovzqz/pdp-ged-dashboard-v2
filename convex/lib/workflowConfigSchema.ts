/**
 * Zod schemas for workflow engine configuration.
 * Used at runtime to validate WorkflowVersion, StepConfig, RetryPolicy, QualityCheckConfig.
 */
import { z } from "zod";

/** Backoff strategy for retries */
export const retryBackoffSchema = z.enum([
  "fixed",
  "exponential",
  "exponential_with_jitter",
]);

export type RetryBackoff = z.infer<typeof retryBackoffSchema>;

/** Retry policy per step */
export const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).default(3),
  backoff: retryBackoffSchema.default("exponential_with_jitter"),
  baseDelayMs: z.number().int().min(0).default(1000),
  maxDelayMs: z.number().int().min(0).default(60_000),
  retryOn: z.array(z.string()).optional(), // error codes/categories to retry
});

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

/** Single step in a workflow version */
export const stepConfigSchema = z.object({
  stepKey: z.string().min(1),
  concurrency: z.number().int().min(1).default(1),
  timeoutMs: z.number().int().min(0).optional(),
  retry: retryPolicySchema.optional(),
});

export type StepConfig = z.infer<typeof stepConfigSchema>;

/** Quality check definition */
export const qualityCheckConfigSchema = z.object({
  checkKey: z.string().min(1),
  checkType: z.enum(["pre_ingest", "post_transform", "pre_publish"]),
  severity: z.enum(["pass", "warn", "fail"]),
  threshold: z.union([z.number(), z.string()]).optional(),
});

export type QualityCheckConfig = z.infer<typeof qualityCheckConfigSchema>;

/** Workflow version (immutable snapshot of config) */
export const workflowVersionSchema = z.object({
  workflowKey: z.string().min(1),
  version: z.string().min(1),
  configSchemaVersion: z.number().int().min(1).default(1),
  steps: z.array(stepConfigSchema).min(1),
  qualityPlanId: z.string().optional(),
  defaultRetry: retryPolicySchema.optional(),
});

export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

/** Scope for a run (validated per workflow key in practice) */
export const runScopeSchema = z.record(z.string(), z.unknown());

export type RunScope = z.infer<typeof runScopeSchema>;

function formatZodError(error: z.ZodError): string {
  const issues = "issues" in error ? (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues : [];
  return issues.length ? issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ") : String(error);
}

/** Validate and parse workflow version config from JSON */
export function parseWorkflowVersion(
  data: unknown
): { success: true; data: WorkflowVersion } | { success: false; error: string } {
  const result = workflowVersionSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: formatZodError(result.error) };
}

/** Validate retry policy from JSON */
export function parseRetryPolicy(
  data: unknown
): { success: true; data: RetryPolicy } | { success: false; error: string } {
  const result = retryPolicySchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: formatZodError(result.error) };
}
