import { query } from "./_generated/server";
import { v } from "convex/values";

/** Resumen de la última reconciliación (scope: universo, un mes o periodo). Una sola fila; se sobrescribe al re-ejecutar. */
export const getReconciliationSummary = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("reconciliationSummary").first();
    return doc;
  },
});

/**
 * Diagnóstico: conteos por mes desde tablas Convex (sin recalcular).
 * paymentRecords desde monthStats; datamapping desde datamappingMonthStatsByFechaTransaccion (mes del pago) si existe, si no datamappingMonthStats (por updatedAt).
 */
export const getReconciliationDiagnosticsTable = query({
  args: {
    months: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { months: monthsArg }) => {
    const months = monthsArg && monthsArg.length > 0
      ? monthsArg.sort()
      : ["2025-12", "2026-01", "2026-02"];
    const cwStats = await ctx.db.query("monthStats").collect();
    const dmByFt = await ctx.db.query("datamappingMonthStatsByFechaTransaccion").collect();
    const dmByUpd = await ctx.db.query("datamappingMonthStats").collect();
    const useByFechaTransaccion = dmByFt.length > 0;
    const dmStats = useByFechaTransaccion ? dmByFt : dmByUpd;
    const cwByMonth = new Map(cwStats.map((s) => [s.month, s.ingestionStatus.totalRecords]));
    const dmByMonth = new Map(
      dmStats.map((s) => [
        s.month,
        {
          totalRecords: s.totalRecords,
          totalRecordsPagoValidado: s.totalRecordsPagoValidado ?? s.totalRecords,
          totalRecordsPagoValidadoDec: s.totalRecordsPagoValidadoDec ?? 0,
        },
      ])
    );
    return months.map((month) => {
      const paymentRecords = cwByMonth.get(month) ?? 0;
      const dm = dmByMonth.get(month);
      const pv = dm?.totalRecordsPagoValidado ?? 0;
      const pvDec = dm?.totalRecordsPagoValidadoDec ?? 0;
      const pvMenosDec = pv - pvDec;
      const diferencia = paymentRecords - pvMenosDec;
      return {
        month,
        paymentRecords,
        datamappingByUpdatedAt: {
          totalRecords: dm?.totalRecords ?? 0,
          pagoValidado: pv,
          pagoValidadoDec: pvDec,
          pvMenosDec,
        },
        diferencia,
        source: useByFechaTransaccion ? "fechaTransaccion" as const : "updatedAt" as const,
      };
    });
  },
});

/** Referencias solo en CloudWatch con fuente payment (PAGO VALIDADO). Para listar referencia y status. */
export const getReconciliationErrorsOnlyCwWithPayment = query({
  args: {},
  handler: async (ctx) => {
    const allOnlyCw = await ctx.db
      .query("reconciliationErrors")
      .withIndex("by_kind", (q) => q.eq("kind", "onlyCw"))
      .take(500);
    return allOnlyCw
      .filter((r) => r.logSource === "payment")
      .map((r) => ({
        referencia: r.referencia,
        status: "PAGO VALIDADO" as const,
        monto: r.monto,
      }));
  },
});

/** Página de errores por tipo (onlyCw | onlyDdb | mismatch | monthMismatch) para tabla y CSV. */
export const getReconciliationErrorsPage = query({
  args: {
    kind: v.union(
      v.literal("onlyCw"),
      v.literal("onlyDdb"),
      v.literal("mismatch"),
      v.literal("monthMismatch")
    ),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { kind, cursor, numItems = 500 }) => {
    const result = await ctx.db
      .query("reconciliationErrors")
      .withIndex("by_kind", (q) => q.eq("kind", kind))
      .order("asc")
      .paginate({ numItems, cursor });
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Diagnóstico: por qué una referencia aparece como "solo en CloudWatch" u otra categoría.
 * Busca en paymentRecords y en datamappingRecords y comprueba si entra en el rango de la reconciliación.
 */
export const investigateReferenciaReconciliation = query({
  args: { referencia: v.optional(v.string()) },
  handler: async (ctx, { referencia }) => {
    if (referencia == null || referencia.trim() === "") {
      return {
        referencia: "",
        paymentRecords: [],
        datamappingRecords: [],
        inJanuary2026Range: false,
        conclusion: "Ingresa una referencia y pulsa Investigar.",
        note: null,
      };
    }
    const ref = referencia.trim();
    const [cwMatches, ddbMatches] = await Promise.all([
      ctx.db
        .query("paymentRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .take(50),
      ctx.db
        .query("datamappingRecords")
        .withIndex("by_referencia", (q) => q.eq("referencia", ref))
        .take(50),
    ]);

    const janStart = "2026-01-01T06:00:00.000Z";
    const janEnd = "2026-02-01T06:00:00.000Z";
    const datamappingWithRange = ddbMatches.map((r) => ({
      referencia: r.referencia,
      monto: r.monto,
      updatedAt: r.updatedAt,
      inJanuary2026: r.updatedAt >= janStart && r.updatedAt < janEnd,
    }));

    const inCw = cwMatches.length > 0;
    const inDdbAny = ddbMatches.length > 0;
    const inDdbJanuary = datamappingWithRange.some((r) => r.inJanuary2026);
    const cwInJanuary2026 = cwMatches.some((r) => r.importMonth === "2026-01");

    let conclusion: string;
    if (!inCw && !inDdbAny) {
      conclusion = "No encontrada en paymentRecords ni en datamappingRecords.";
    } else if (inCw && !inDdbAny) {
      conclusion =
        "Está en CloudWatch (paymentRecords) pero no hay ningún registro en datamappingRecords con esta referencia exacta. Posibles causas: (1) referencia en DynamoDB con otro formato (ej. número que perdió precisión > 2^53); (2) aún no ingerido.";
    } else if (!inCw && inDdbAny) {
      conclusion =
        "Está en datamappingRecords pero no en paymentRecords.";
    } else if (cwInJanuary2026 && inDdbJanuary) {
      conclusion =
        "Está en ambas tablas con importMonth 2026-01 (paymentRecords) y updatedAt en enero 2026 (datamapping). Debería aparecer como match o mismatch; si no, revisar duplicados o prioridad.";
    } else if (!cwInJanuary2026 && inDdbJanuary) {
      const months = [...new Set(cwMatches.map((r) => r.importMonth))].join(", ");
      conclusion =
        `Está en ambas tablas, pero en paymentRecords el importMonth no es 2026-01 (tiene: ${months}). La reconciliación solo considera paymentRecords de enero 2026; en datamapping sí tiene updatedAt en enero 2026. Por eso aparece como "Solo en Datamapping".`;
    } else if (cwInJanuary2026 && !inDdbJanuary) {
      conclusion =
        "Está en paymentRecords con importMonth 2026-01, pero en datamappingRecords el updatedAt está fuera de enero 2026. La reconciliación solo considera datamapping con updatedAt en ese rango; por eso aparece como 'Solo en CloudWatch'.";
    } else {
      conclusion =
        "Está en ambas tablas; ni paymentRecords tiene importMonth 2026-01 ni datamapping tiene updatedAt en enero 2026. Para esta reconciliación (ene 2026) no entra en ninguno de los dos lados.";
    }

    return {
      referencia: ref,
      paymentRecords: cwMatches.map((r) => ({
        referencia: r.referencia,
        monto: r.monto,
        logSource: r.logSource,
        importMonth: r.importMonth,
        importDate: r.importDate,
      })),
      datamappingRecords: datamappingWithRange,
      inJanuary2026Range: inDdbJanuary,
      conclusion,
      note: "Referencias numéricas > 2^53 pueden truncarse si DynamoDB las guarda como número (precisión JS).",
    };
  },
});
