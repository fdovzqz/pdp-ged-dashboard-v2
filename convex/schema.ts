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

  /** ─── Tablas agregadas DataMapping (origen DynamoDB) ─── */

  rawHourlyDataDatamapping: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    hour: v.number(),
    events: v.number(),
    totalAmount: v.number(),
  }).index("by_year_month_day_hour", ["year", "month", "day", "hour"]),

  dailyDataDatamapping: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    events: v.number(),
    totalAmount: v.number(),
    transactionCount: v.number(),
    isComplete: v.boolean(),
  }).index("by_year_month_day", ["year", "month", "day"]),

  monthlyDataDatamapping: defineTable({
    year: v.number(),
    month: v.number(),
    events: v.number(),
    totalAmount: v.number(),
  }).index("by_year_month", ["year", "month"]),

  hourlyDistributionDatamapping: defineTable({
    year: v.number(),
    month: v.number(),
    dayType: v.string(),
    hour: v.number(),
    events: v.number(),
  }).index("by_year_month_type_hour", ["year", "month", "dayType", "hour"]),

  dailyAmountDataDatamapping: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    totalAmount: v.number(),
    transactionCount: v.number(),
  }).index("by_year_month_day", ["year", "month", "day"]),

  amountByMovementDatamapping: defineTable({
    year: v.number(),
    month: v.number(),
    movimiento: v.string(),
    totalAmount: v.number(),
    count: v.number(),
  }).index("by_year_month_movimiento", ["year", "month", "movimiento"]),

  /** Desglose por fuente (EVO, DEC, CODI, MIT, NO_DEFINIDO) por día. */
  datamappingDailyFuenteBreakdown: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    fuente: v.string(),
    count: v.number(),
    monto: v.number(),
  }).index("by_year_month_day", ["year", "month", "day"]),

  /** Desglose EVO (Tarjeta) vs Transferencia por día, para PaymentChannelsSection. */
  datamappingDailySourceBreakdown: defineTable({
    year: v.number(),
    month: v.number(),
    day: v.number(),
    evoCount: v.number(),
    evoMonto: v.number(),
    ventanillaCount: v.number(),
    ventanillaMonto: v.number(),
  }).index("by_year_month_day", ["year", "month", "day"]),

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

  /** Registros de DynamoDB datamapping (backup Prod) para reconciliación Enero 2026. */
  datamappingRecords: defineTable({
    referencia: v.string(),
    monto: v.number(),
    fechaPago: v.optional(v.string()),
    fuente: v.optional(v.string()),
    urlPago: v.optional(v.string()),
    tipoMovimiento: v.optional(v.string()),
    updatedAt: v.string(),
    rawJson: v.string(),
  })
    .index("by_referencia", ["referencia"])
    .index("by_updatedAt", ["updatedAt"]),

  /** Control de procesamiento ETL. */
  processingControl: defineTable({
    key: v.string(),
    lastCompleteDay: v.number(),
    lastProcessedTimestamp: v.string(),
    year: v.number(),
    month: v.number(),
  }).index("by_key", ["key"]),

  /** Resumen de la última reconciliación Enero 2026 (una sola fila, se sobrescribe al re-ejecutar). */
  reconciliationSummary: defineTable({
    month: v.string(),
    runAt: v.number(),
    matchCount: v.number(),
    onlyCwCount: v.number(),
    onlyDdbCount: v.number(),
    mismatchCount: v.number(),
    /** En ambos lados, mismo monto, pero mes CW ≠ mes DDB (no grave). */
    monthMismatchCount: v.optional(v.number()),
    totalUnique: v.number(),
  }).index("by_month", ["month"]),

  /** Errores/diferencias de reconciliación; se borran al re-ejecutar. kind: onlyCw | onlyDdb | mismatch | monthMismatch */
  reconciliationErrors: defineTable({
    kind: v.union(
      v.literal("onlyCw"),
      v.literal("onlyDdb"),
      v.literal("mismatch"),
      v.literal("monthMismatch")
    ),
    referencia: v.string(),
    monto: v.optional(v.number()),
    logSource: v.optional(v.string()),
    montoCloudWatch: v.optional(v.number()),
    montoDynamoDB: v.optional(v.number()),
    /** Mes en paymentRecords (importMonth) cuando aplica. */
    importMonth: v.optional(v.string()),
    /** updatedAt del registro en datamapping cuando aplica (para mostrar mes). */
    datamappingUpdatedAt: v.optional(v.string()),
  }).index("by_kind", ["kind"]),
});
