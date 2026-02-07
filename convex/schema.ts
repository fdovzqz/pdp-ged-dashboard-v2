import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  paymentRecords: defineTable({
    referencia: v.string(),
    monto: v.number(),
    timestamp: v.string(),
    fechaTransaccion: v.string(),
    logSource: v.union(
      v.literal("v1"),
      v.literal("v2"),
      v.literal("payment")
    ),
    movimiento: v.string(),
    estatus: v.string(),
    tramiteId: v.optional(v.number()),
    rawData: v.optional(v.string()),
    importMonth: v.string(),
    importDate: v.optional(v.string()),
  })
    .index("by_referencia", ["referencia"])
    .index("by_source", ["logSource"])
    .index("by_month", ["importMonth"])
    .index("by_month_and_referencia", ["importMonth", "referencia"])
    .index("by_source_and_month", ["logSource", "importMonth"])
    .index("by_source_month_referencia", ["logSource", "importMonth", "referencia"])
    .index("by_source_and_date", ["logSource", "importDate"]),

  /** Estadísticas precalculadas por mes. Actualizadas al sincronizar. */
  monthStats: defineTable({
    month: v.string(),
    dayEntries: v.array(
      v.object({
        date: v.string(),
        count: v.number(),
        monto: v.number(),
        v1: v.number(),
        v2: v.number(),
        payment: v.number(),
        v1Monto: v.optional(v.number()),
        v2Monto: v.optional(v.number()),
        paymentMonto: v.optional(v.number()),
        byMovimiento: v.array(
          v.object({
            movimiento: v.string(),
            count: v.number(),
            monto: v.number(),
            v1: v.number(),
            v2: v.number(),
            payment: v.number(),
          })
        ),
        refs: v.array(v.string()),
      })
    ),
    kpis: v.object({
      totalPagos: v.number(),
      montoTotal: v.number(),
      referenciasUnicas: v.number(),
      promedioDiario: v.number(),
      diasConDatos: v.number(),
      porFuente: v.record(v.string(), v.number()),
    }),
    dailyBreakdown: v.array(
      v.object({
        date: v.string(),
        count: v.number(),
        monto: v.number(),
        v1: v.number(),
        v2: v.number(),
        payment: v.number(),
        v1Monto: v.optional(v.number()),
        v2Monto: v.optional(v.number()),
        paymentMonto: v.optional(v.number()),
      })
    ),
    movementStats: v.array(
      v.object({
        movimiento: v.string(),
        count: v.number(),
        monto: v.number(),
        v1: v.number(),
        v2: v.number(),
        payment: v.number(),
      })
    ),
    sourceStats: v.array(
      v.object({
        source: v.string(),
        count: v.number(),
        monto: v.number(),
        pctCount: v.number(),
        pctMonto: v.number(),
      })
    ),
    ingestionStatus: v.object({
      totalRecords: v.number(),
      daysWithData: v.number(),
      byDate: v.array(v.object({ date: v.string(), count: v.number() })),
    }),
    lastUpdated: v.number(),
  }).index("by_month", ["month"]),

  /** Tablas agregadas para dashboard de Enero (análisis multi-año) */

  /** Eventos por hora para rebuild de agregados. */
  rawHourlyData: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    hour: v.number(),
    events: v.number(),
    totalAmount: v.number(),
  }).index("by_year_month_day_hour", ["year", "month", "day", "hour"]),

  /** Datos diarios agregados. */
  dailyData: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    events: v.number(),
    totalAmount: v.number(),
    transactionCount: v.number(),
    isComplete: v.boolean(),
  }).index("by_year_month_day", ["year", "month", "day"]),

  /** Totales mensuales. */
  monthlyData: defineTable({
    year: v.number(),
    month: v.number(),
    events: v.number(),
    totalAmount: v.number(),
  }).index("by_year_month", ["year", "month"]),

  /** Distribución horaria por tipo de día (weekday/weekend). */
  hourlyDistribution: defineTable({
    year: v.number(),
    month: v.number(),
    dayType: v.string(),
    hour: v.number(),
    events: v.number(),
  }).index("by_year_month_type_hour", ["year", "month", "dayType", "hour"]),

  /** Monto diario agregado. */
  dailyAmountData: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    totalAmount: v.number(),
    transactionCount: v.number(),
  }).index("by_year_month_day", ["year", "month", "day"]),

  /** Monto por movimiento (tipo de trámite). */
  amountByMovement: defineTable({
    year: v.number(),
    month: v.number(),
    movimiento: v.string(),
    totalAmount: v.number(),
    count: v.number(),
  }).index("by_year_month_movimiento", ["year", "month", "movimiento"]),

  /** Notas de análisis editables. */
  analysisNotes: defineTable({
    id: v.string(),
    yearLabel: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    accentColor: v.string(),
    order: v.number(),
  }).index("by_order", ["order"]),

  /** Códigos y descripciones de movimientos (editable sin redeploy). */
  movementCodes: defineTable({
    codigo: v.string(),
    descripcion: v.string(),
    order: v.optional(v.number()),
  })
    .index("by_codigo", ["codigo"])
    .index("by_order", ["order"]),

  /** Aliases: variante -> código canónico (REFRE->REFRENDO, IMPUESTO PREDIAL->PREDIAL). */
  movementAliases: defineTable({
    variante: v.string(),
    codigoCanonico: v.string(),
  })
    .index("by_variante", ["variante"])
    .index("by_codigo", ["codigoCanonico"]),

  /** Control de procesamiento ETL. */
  processingControl: defineTable({
    key: v.string(),
    lastCompleteDay: v.number(),
    lastProcessedTimestamp: v.string(),
    year: v.number(),
    month: v.number(),
  }).index("by_key", ["key"]),
});
