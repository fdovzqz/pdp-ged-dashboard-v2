/**
 * Zod schemas for declarative RuleSets (dedup, reconciliation, enrichment).
 * Used to store and validate versioned rules applied at runtime.
 */
import { z } from "zod";

/** Domain of the rule set */
export const ruleSetDomainSchema = z.enum([
  "dedup",
  "reconciliation",
  "enrichment",
  "clean",
  "quality",
]);

export type RuleSetDomain = z.infer<typeof ruleSetDomainSchema>;

/** Dedup rule: priority order of sources when same key appears in multiple (e.g. payment > v2 > v1). */
export const dedupPriorityRuleSchema = z.object({
  type: z.literal("priority"),
  keyField: z.string(), // e.g. "referencia", "transactionId"
  sourcePriority: z.array(z.string()), // first = highest priority, e.g. ["payment", "v2", "v1"]
});

/** Reconciliation comparable set: which status/filter to use per source. */
export const reconciliationComparableRuleSchema = z.object({
  type: z.literal("comparable"),
  sourceKey: z.string(),
  filter: z.record(z.string(), z.unknown()).optional(), // e.g. { status: "PAGO VALIDADO" }
});

/** Normalize rule: map raw values to canonical (e.g. status PA -> PAGO VALIDADO). */
export const normalizeRuleSchema = z.object({
  type: z.literal("normalize"),
  field: z.string(),
  mappings: z.record(z.string(), z.string()),
});

/** Single rule in a rule set */
export const ruleItemSchema = z.union([
  dedupPriorityRuleSchema,
  reconciliationComparableRuleSchema,
  normalizeRuleSchema,
]);

export type RuleItem = z.infer<typeof ruleItemSchema>;

/** Full rule set version (immutable). */
export const ruleSetVersionSchema = z.object({
  ruleSetKey: z.string(),
  domain: ruleSetDomainSchema,
  version: z.string(),
  rules: z.array(ruleItemSchema),
  activationPolicy: z.enum(["default", "opt_in"]).default("default"),
});

export type RuleSetVersion = z.infer<typeof ruleSetVersionSchema>;

/** Parse rule set from JSON. */
export function parseRuleSetVersion(
  data: unknown
): { success: true; data: RuleSetVersion } | { success: false; error: string } {
  const result = ruleSetVersionSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  const issues =
    "issues" in result.error
      ? (result.error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues
      : [];
  const msg = issues.length
    ? issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
    : String(result.error);
  return { success: false, error: msg };
}

/** Extract dedup source priority from a parsed rule set (domain === "dedup"). */
export function getDedupSourcePriority(ruleSet: RuleSetVersion): string[] {
  const priorityRule = ruleSet.rules.find(
    (r): r is z.infer<typeof dedupPriorityRuleSchema> => r.type === "priority"
  );
  return priorityRule?.sourcePriority ?? [];
}
