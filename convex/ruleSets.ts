import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getDedupSourcePriority } from "./lib/ruleSetSchema";
import type { RuleSetVersion } from "./lib/ruleSetSchema";
import { parseRuleSetVersion } from "./lib/ruleSetSchema";

/** Get the active (latest) rule set for a domain and optional source. */
export const getActiveForDomain = query({
  args: {
    domain: v.union(
      v.literal("dedup"),
      v.literal("reconciliation"),
      v.literal("enrichment"),
      v.literal("clean"),
      v.literal("quality")
    ),
    sourceKey: v.optional(v.string()),
  },
  handler: async (ctx, { domain, sourceKey }) => {
    if (sourceKey) {
      const doc = await ctx.db
        .query("ruleSets")
        .withIndex("by_domain_source_createdAt", (q) =>
          q.eq("domain", domain).eq("sourceKey", sourceKey)
        )
        .order("desc")
        .first();
      if (!doc) return null;
      const parsed = parseRuleSetVersion({ ...doc, rules: doc.rules });
      if (!parsed.success) return null;
      return { ...doc, parsed: parsed.data } as { _id: typeof doc._id; parsed: RuleSetVersion };
    }
    const doc = await ctx.db
      .query("ruleSets")
      .withIndex("by_domain_createdAt", (q) => q.eq("domain", domain))
      .order("desc")
      .first();
    if (!doc) return null;
    const parsed = parseRuleSetVersion({
      ruleSetKey: doc.ruleSetKey,
      domain: doc.domain,
      version: doc.version,
      rules: doc.rules,
      activationPolicy: doc.activationPolicy ?? "default",
    });
    if (!parsed.success) return null;
    return { ...doc, parsed: parsed.data } as { _id: typeof doc._id; parsed: RuleSetVersion };
  },
});

/** Get a single rule set by id with full rules (for detail view). */
export const getRuleSet = query({
  args: { id: v.id("ruleSets") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    return {
      _id: doc._id,
      ruleSetKey: doc.ruleSetKey,
      domain: doc.domain,
      version: doc.version,
      activationPolicy: doc.activationPolicy ?? "default",
      sourceKey: doc.sourceKey,
      createdAt: doc.createdAt,
      createdBy: doc.createdBy,
      rules: doc.rules,
    };
  },
});

/** List rule sets for catalog: latest first, optionally limited. */
export const listRuleSets = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 100 }) => {
    const docs = await ctx.db
      .query("ruleSets")
      .withIndex("by_createdAt", (q) => q)
      .order("desc")
      .take(limit);
    return docs.map((doc) => ({
      _id: doc._id,
      ruleSetKey: doc.ruleSetKey,
      domain: doc.domain,
      version: doc.version,
      activationPolicy: doc.activationPolicy ?? "default",
      sourceKey: doc.sourceKey,
      createdAt: doc.createdAt,
      createdBy: doc.createdBy,
      rulesSummary:
        Array.isArray(doc.rules) && doc.rules.length > 0
          ? doc.rules.map((r: { type?: string }) => r?.type ?? "unknown")
          : [],
    }));
  },
});

/** Returns dedup source priority order for CloudWatch (e.g. ["payment", "v2", "v1"]). Uses rule set if present, else default. */
export const getDedupOrderForCloudWatch = query({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("ruleSets")
      .withIndex("by_domain_source_createdAt", (q) =>
        q.eq("domain", "dedup").eq("sourceKey", "cloudwatch")
      )
      .order("desc")
      .first();
    if (!active?.rules) return ["payment", "v2", "v1"];
    const parsed = parseRuleSetVersion({
      ruleSetKey: active.ruleSetKey,
      domain: "dedup",
      version: active.version,
      rules: active.rules,
      activationPolicy: active.activationPolicy ?? "default",
    });
    if (!parsed.success) return ["payment", "v2", "v1"];
    const priority = getDedupSourcePriority(parsed.data);
    return priority.length > 0 ? priority : ["payment", "v2", "v1"];
  },
});

/** Insert a new rule set version (immutable). */
export const insertRuleSet = mutation({
  args: {
    ruleSetKey: v.string(),
    domain: v.union(
      v.literal("dedup"),
      v.literal("reconciliation"),
      v.literal("enrichment"),
      v.literal("clean"),
      v.literal("quality")
    ),
    version: v.string(),
    rules: v.any(),
    activationPolicy: v.optional(v.union(v.literal("default"), v.literal("opt_in"))),
    sourceKey: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const parsed = parseRuleSetVersion({
      ruleSetKey: args.ruleSetKey,
      domain: args.domain,
      version: args.version,
      rules: args.rules,
      activationPolicy: args.activationPolicy ?? "default",
    });
    if (!parsed.success) throw new Error(parsed.error);
    return await ctx.db.insert("ruleSets", {
      ruleSetKey: args.ruleSetKey,
      domain: args.domain,
      version: args.version,
      rules: args.rules,
      activationPolicy: args.activationPolicy,
      sourceKey: args.sourceKey,
      createdAt: Date.now(),
      createdBy: args.createdBy,
    });
  },
});

/** Reglas por defecto necesarias para la importación CloudWatch + Datamapping (mensual, periodo, día, desde fecha). Solo crea las que no existan. */
const DEFAULT_IMPORT_RULE_SETS: Array<{
  ruleSetKey: string;
  domain: "dedup" | "reconciliation" | "enrichment" | "clean" | "quality";
  version: string;
  sourceKey: string;
  rules: unknown[];
}> = [
  // Dedup: CloudWatch (prioridad por referencia). Usado por sync mensual, por rango, incremental y load-from-date.
  {
    ruleSetKey: "cloudwatch-dedup",
    domain: "dedup",
    version: "1.0.0",
    sourceKey: "cloudwatch",
    rules: [
      {
        type: "priority",
        keyField: "referencia",
        sourcePriority: ["payment", "v2", "v1"],
      },
    ],
  },
  // Reconciliation: conjuntos comparables por fuente (reconcile CloudWatch vs Datamapping).
  {
    ruleSetKey: "reconciliation-cloudwatch",
    domain: "reconciliation",
    version: "1.0.0",
    sourceKey: "cloudwatch",
    rules: [
      { type: "comparable", sourceKey: "cloudwatch", filter: { status: "PAGO VALIDADO" } },
    ],
  },
  {
    ruleSetKey: "reconciliation-datamapping",
    domain: "reconciliation",
    version: "1.0.0",
    sourceKey: "datamapping",
    rules: [{ type: "comparable", sourceKey: "datamapping" }],
  },
  // Clean: normalización de estatus y campos (extract/clean/dedup). Misma lógica para cualquier scope.
  {
    ruleSetKey: "clean-cloudwatch",
    domain: "clean",
    version: "1.0.0",
    sourceKey: "cloudwatch",
    rules: [
      {
        type: "normalize",
        field: "estatus",
        mappings: {
          PA: "PAGO VALIDADO",
          PAGO: "PAGO VALIDADO",
          "PAGO VALIDADO": "PAGO VALIDADO",
        },
      },
    ],
  },
  {
    ruleSetKey: "clean-datamapping",
    domain: "clean",
    version: "1.0.0",
    sourceKey: "datamapping",
    rules: [
      {
        type: "normalize",
        field: "status",
        mappings: {},
      },
    ],
  },
  // Enrichment: reglas para enriquecimiento desde raw (datamapping_enrichment_by_months, backfill, fecha_transaccion).
  {
    ruleSetKey: "enrichment-datamapping",
    domain: "enrichment",
    version: "1.0.0",
    sourceKey: "datamapping",
    rules: [],
  },
  // Quality: controles pre-ingest / post-transform (opcional; engine puede consumir más adelante).
  {
    ruleSetKey: "quality-global",
    domain: "quality",
    version: "1.0.0",
    sourceKey: "global",
    rules: [],
  },
];

/**
 * Asegura que existan las reglas necesarias para la importación (CloudWatch + Datamapping).
 * Inserta solo las que no tengan ya un RuleSet activo para ese domain+sourceKey.
 * Devuelve la lista de rule sets creados (identificados por "domain/sourceKey").
 */
export const ensureRuleSetsForImport = mutation({
  args: {},
  handler: async (ctx): Promise<{ created: string[] }> => {
    const created: string[] = [];
    for (const def of DEFAULT_IMPORT_RULE_SETS) {
      const existing = await ctx.db
        .query("ruleSets")
        .withIndex("by_domain_source_createdAt", (q) =>
          q.eq("domain", def.domain).eq("sourceKey", def.sourceKey)
        )
        .order("desc")
        .first();
      if (existing) continue;

      const parsed = parseRuleSetVersion({
        ruleSetKey: def.ruleSetKey,
        domain: def.domain,
        version: def.version,
        rules: def.rules,
        activationPolicy: "default",
      });
      if (!parsed.success) throw new Error(parsed.error);

      await ctx.db.insert("ruleSets", {
        ruleSetKey: def.ruleSetKey,
        domain: def.domain,
        version: def.version,
        rules: def.rules,
        activationPolicy: "default",
        sourceKey: def.sourceKey,
        createdAt: Date.now(),
        createdBy: "ensureRuleSetsForImport",
      });
      created.push(`${def.domain}/${def.sourceKey}`);
    }
    return { created };
  },
});
