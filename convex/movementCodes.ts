/**
 * Códigos y descripciones de movimientos.
 * Todo se gestiona desde las tablas movementCodes y movementAliases en Convex.
 * Sin valores hardcodeados: editable desde la UI en Upload.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";

/** Datos para seed inicial (solo al poblar la tabla la primera vez) */
const SEED_CODES: Array<{ codigo: string; descripcion: string }> = [
  { codigo: "IAR", descripcion: "Impuesto al almacenamiento de residuos" },
  { codigo: "IECSA", descripcion: "Impuesto a la emisión de contaminantes al suelo, subsuelo y agua" },
  { codigo: "DENOM", descripcion: "Impuesto sobre nómina" },
  { codigo: "DEAUT", descripcion: "Impuesto a la enajenación de vehículos" },
  { codigo: "DEHOS", descripcion: "Impuesto por servicio de hospedaje" },
  { codigo: "IVFBA", descripcion: "Impuesto a la venta final de bebidas alcohólicas" },
  { codigo: "IEGA", descripcion: "Impuesto a la emisión de gases a la atmósfera" },
  { codigo: "IPREEM", descripcion: "Placas automóvil, camión y autobús servicio particular y fomento a la educación" },
  { codigo: "OUGTBI", descripcion: "Impuesto por otorgar el uso o goce temporal de bienes inmuebles" },
  { codigo: "REFRENDO", descripcion: "Refrendo" },
  { codigo: "PREDIAL", descripcion: "Impuesto predial" },
];

const SEED_ALIASES: Array<{ variante: string; codigoCanonico: string }> = [
  { variante: "REFRE", codigoCanonico: "REFRENDO" },
  { variante: "REFREDD", codigoCanonico: "REFRENDO" },
  { variante: "IMPUESTO SOBRE NOMINA", codigoCanonico: "DENOM" },
  { variante: "IMPUESTO SOBRE NÓMINA", codigoCanonico: "DENOM" },
  { variante: "IMPUESTO SOBRE AUTOS NUEVOS", codigoCanonico: "DEAUT" },
  { variante: "IMPTO SOBRE NOMINA", codigoCanonico: "DENOM" },
  { variante: "IMPTO SOBRE NÓMINA", codigoCanonico: "DENOM" },
  { variante: "REPLAQUEO", codigoCanonico: "IPREEM" },
  { variante: "IMPUESTO PREDIAL", codigoCanonico: "PREDIAL" },
];

/** Normaliza string a ASCII (Convex rechaza acentos en object keys e index values). Exportado para uso en ETL/actions. */
export function toAscii(s: string): string {
  if (typeof s !== "string" || !s) return "";
  const decomposed = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return decomposed.replace(/[^\x20-\x7E]/g, "");
}

/** Lee config desde DB (solo tablas, sin fallback en código) */
export async function getMovementConfig(ctx: QueryCtx): Promise<{
  descriptions: Record<string, string>;
  aliases: Record<string, string>;
}> {
  const descriptions: Record<string, string> = {};
  const aliases: Record<string, string> = {};

  const dbCodes = await ctx.db.query("movementCodes").collect();
  for (const row of dbCodes) {
    const key = toAscii(row.codigo.toUpperCase());
    if (key) descriptions[key] = row.descripcion;
  }

  const dbAliases = await ctx.db.query("movementAliases").collect();
  for (const row of dbAliases) {
    const key = toAscii(row.variante.toUpperCase());
    if (key) aliases[key] = toAscii(row.codigoCanonico.toUpperCase());
  }

  return { descriptions, aliases };
}

/** Normaliza usando config de DB. Siempre devuelve ASCII (Convex rechaza acentos en values/indexes). */
export function normalizeWithConfig(
  raw: string,
  config: { descriptions: Record<string, string>; aliases: Record<string, string> }
): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  const upper = trimmed.toUpperCase();
  const upperAscii = toAscii(upper);
  const { descriptions, aliases } = config;

  const canonCodes = new Set(Object.keys(descriptions).map((c) => c.toUpperCase()));

  let result: string;
  if (canonCodes.has(upper) || canonCodes.has(upperAscii)) {
    const found = Object.keys(descriptions).find(
      (k) => k.toUpperCase() === upper || k.toUpperCase() === upperAscii
    );
    result = found ?? upperAscii;
  } else if (aliases[upper]) {
    result = aliases[upper];
  } else if (aliases[upperAscii]) {
    result = aliases[upperAscii];
  } else {
    result = upperAscii;
  }

  // Fallbacks por palabras clave: evita duplicados si aliases está vacío o incompleto
  const norm = toAscii(result).toUpperCase();
  if (norm.includes("REFRE") || norm === "REFRE" || norm === "REFREDD") return "REFRENDO";
  if (norm.includes("PREDIAL")) return "PREDIAL";
  if (norm.includes("NOMINA")) return "DENOM";
  if (norm.includes("REPLAQUEO")) return "IPREEM";

  return toAscii(result);
}

/** Obtiene descripción usando config de DB */
export function getDescriptionWithConfig(
  codigo: string,
  config: { descriptions: Record<string, string>; aliases: Record<string, string> }
): string {
  const trimmed = String(codigo ?? "").trim();
  if (!trimmed) return "(sin tipo)";

  const upper = trimmed.toUpperCase();
  const aliasResolved = config.aliases[upper] ?? upper;
  const desc = config.descriptions[aliasResolved];
  return desc ?? upper;
}

/** Query: devuelve config para el dashboard */
export const getMovementCodesConfig = query({
  args: {},
  handler: async (ctx) => {
    return await getMovementConfig(ctx);
  },
});

/** Query: lista todos los códigos para edición */
export const listMovementCodes = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("movementCodes").collect();
    return rows.sort((a, b) => a.codigo.localeCompare(b.codigo));
  },
});

/** Query: lista todos los aliases */
export const listMovementAliases = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("movementAliases").collect();
    return rows.sort((a, b) => a.variante.localeCompare(b.variante));
  },
});

/** Mutation: inserta o actualiza código */
export const upsertMovementCode = mutation({
  args: {
    codigo: v.string(),
    descripcion: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { codigo, descripcion, order }) => {
    const key = codigo.toUpperCase();
    const existing = await ctx.db
      .query("movementCodes")
      .withIndex("by_codigo", (q) => q.eq("codigo", key))
      .first();

    const row = {
      codigo: key,
      descripcion,
      ...(order != null && { order }),
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { updated: true, id: existing._id };
    } else {
      const id = await ctx.db.insert("movementCodes", row);
      return { inserted: true, id };
    }
  },
});

/** Mutation: elimina código */
export const deleteMovementCode = mutation({
  args: { codigo: v.string() },
  handler: async (ctx, { codigo }) => {
    const key = codigo.toUpperCase();
    const existing = await ctx.db
      .query("movementCodes")
      .withIndex("by_codigo", (q) => q.eq("codigo", key))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});

/** Mutation: inserta o actualiza alias */
export const upsertMovementAlias = mutation({
  args: {
    variante: v.string(),
    codigoCanonico: v.string(),
  },
  handler: async (ctx, { variante, codigoCanonico }) => {
    const vKey = toAscii(variante.toUpperCase());
    const cKey = codigoCanonico.toUpperCase();
    const existing = await ctx.db
      .query("movementAliases")
      .withIndex("by_variante", (q) => q.eq("variante", vKey))
      .first();

    const row = { variante: vKey, codigoCanonico: cKey };

    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { updated: true, id: existing._id };
    } else {
      const id = await ctx.db.insert("movementAliases", row);
      return { inserted: true, id };
    }
  },
});

/** Mutation: elimina alias */
export const deleteMovementAlias = mutation({
  args: { variante: v.string() },
  handler: async (ctx, { variante }) => {
    const key = toAscii(variante.toUpperCase());
    const existing = await ctx.db
      .query("movementAliases")
      .withIndex("by_variante", (q) => q.eq("variante", key))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});

/** Mutation: seed inicial de códigos y aliases */
export const seedMovementCodes = mutation({
  args: {},
  handler: async (ctx) => {
    let codesInserted = 0;
    let aliasesInserted = 0;

    for (const { codigo, descripcion } of SEED_CODES) {
      const existing = await ctx.db
        .query("movementCodes")
        .withIndex("by_codigo", (q) => q.eq("codigo", codigo))
        .first();
      if (!existing) {
        await ctx.db.insert("movementCodes", { codigo, descripcion });
        codesInserted++;
      }
    }

    for (const { variante, codigoCanonico } of SEED_ALIASES) {
      const vKey = toAscii(variante.toUpperCase());
      const existing = await ctx.db
        .query("movementAliases")
        .withIndex("by_variante", (q) => q.eq("variante", vKey))
        .first();
      if (!existing) {
        await ctx.db.insert("movementAliases", { variante: vKey, codigoCanonico: codigoCanonico.toUpperCase() });
        aliasesInserted++;
      }
    }

    return {
      codesInserted,
      aliasesInserted,
      totalCodes: SEED_CODES.length,
      totalAliases: SEED_ALIASES.length,
    };
  },
});
