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
    /** Llave única en DynamoDB (id de transacción). Usado para upsert sin OCC. */
    transactionId: v.string(),
    /** Referencia de pago (puede repetirse en varios meses si se actualiza). */
    referencia: v.string(),
    monto: v.number(),
    fechaPago: v.optional(v.string()),
    fuente: v.optional(v.string()),
    urlPago: v.optional(v.string()),
    tipoMovimiento: v.optional(v.string()),
    updatedAt: v.string(),
    rawJson: v.string(),
    /** RFC extraído de rawJson por ETL (para búsqueda rápida por RFC). */
    rfc: v.optional(v.string()),
    /** @deprecated El backfill "Preparar enrichmentExtracted" hace patch con rfcExtracted: undefined; tras ejecutarlo en toda la tabla se puede eliminar este campo del schema. */
    rfcExtracted: v.optional(v.boolean()),
    /** true = ya fue enriquecido (RFC + placa, evoId, etc.); false = pendiente. Evita reprocesar salvo rerun explícito. */
    enrichmentExtracted: v.optional(v.boolean()),
    /** Campos extraídos de rawJson por enriquecimiento (placa, evoId, etc.). */
    placa: v.optional(v.string()),
    evoId: v.optional(v.string()),
    codiId: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    folioNumber: v.optional(v.string()),
    loteId: v.optional(v.string()),
    procedureCategory: v.optional(v.string()),
    tramiteId: v.optional(v.string()),
    userId: v.optional(v.string()),
    /** Estado del pago en DynamoDB (ej. PAGO VALIDADO). Extraído en carga; usado para filtrar tableros mensual/anual solo por pagos validados. */
    status: v.optional(v.string()),
    /** Fecha de transacción desde paymentRecords (por referencia); fallback a updatedAt si no existe en CloudWatch. Usada para agregaciones y tableros. */
    fechaTransaccion: v.optional(v.string()),
    /** YYYY-MM-DD en hora México (UTC-6), derivado de fechaTransaccion. Índice para filtrar por mes en tableros. */
    fechaTransaccionMexico: v.optional(v.string()),
  })
    .index("by_transactionId", ["transactionId"])
    .index("by_referencia", ["referencia"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_rfc", ["rfc"])
    .index("by_tipoMovimiento_updatedAt", ["tipoMovimiento", "updatedAt"])
    .index("by_enrichmentExtracted_updatedAt", ["enrichmentExtracted", "updatedAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_status_fechaTransaccion", ["status", "fechaTransaccion"])
    .index("by_status_fechaTransaccionMexico", ["status", "fechaTransaccionMexico"]),

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

  /** Historial de ejecuciones de enriquecimiento RFC (persiste al refrescar la UI). */
  rfcEnrichmentRuns: defineTable({
    startedAt: v.number(),
    fromDate: v.string(),
    toDate: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("timed_out"),
      v.literal("error")
    ),
    processed: v.optional(v.number()),
    enriched: v.optional(v.number()),
    message: v.optional(v.string()),
    continueState: v.optional(
      v.union(
        v.object({
          tipoMovIndex: v.number(),
          cursor: v.union(v.string(), v.null()),
          tipoMovOrder: v.array(v.string()),
        }),
        v.object({
          cursor: v.union(v.string(), v.null()),
          updatedAtFrom: v.string(),
          updatedAtTo: v.string(),
        })
      )
    ),
    completedAt: v.optional(v.number()),
  }).index("by_startedAt", ["startedAt"]),

  /** Resultados guardados de la investigación RFC → referencias (rango: enero a fecha). */
  rfcInvestigationResults: defineTable({
    runAt: v.number(),
    fromDate: v.string(),
    toDate: v.string(),
    matchCount: v.number(),
    matches: v.array(
      v.object({
        rfc: v.string(),
        referencia: v.string(),
        monto: v.number(),
        updatedAt: v.string(),
        tipoMovimiento: v.optional(v.string()),
        fuente: v.optional(v.string()),
        status: v.optional(v.string()),
        loteId: v.optional(v.string()),
        tramiteId: v.optional(v.string()),
        reciboPagoUrl: v.optional(v.string()),
        /** @deprecated Nombre antiguo; documentos guardados antes del cambio pueden tenerlo. La UI usa reciboPagoUrl con fallback a este. */
        referenciaPagoUrl: v.optional(v.string()),
        endMonth: v.optional(v.string()),
        declarationType: v.optional(v.string()),
      })
    ),
  }).index("by_runAt", ["runAt"]),

  /** Conteo agregado de datamappingRecords (total, PAGO VALIDADO, PAGO VALIDADO-DEC). Comparación: CloudWatch vs totalPagoValidadoDec. */
  datamappingIngestionStats: defineTable({
    total: v.number(),
    totalPagoValidado: v.optional(v.number()),
    totalPagoValidadoDec: v.optional(v.number()),
    byYear: v.array(v.object({ year: v.string(), count: v.number() })),
    byYearPagoValidado: v.optional(v.array(v.object({ year: v.string(), count: v.number() }))),
    byYearPagoValidadoDec: v.optional(v.array(v.object({ year: v.string(), count: v.number() }))),
    byMonth: v.array(v.object({ month: v.string(), count: v.number() })),
    byMonthPagoValidado: v.optional(v.array(v.object({ month: v.string(), count: v.number() }))),
    byMonthPagoValidadoDec: v.optional(v.array(v.object({ month: v.string(), count: v.number() }))),
    byDay: v.array(v.object({ date: v.string(), count: v.number() })),
    byDayPagoValidado: v.optional(v.array(v.object({ date: v.string(), count: v.number() }))),
    byDayPagoValidadoDec: v.optional(v.array(v.object({ date: v.string(), count: v.number() }))),
    lastUpdated: v.number(),
  }),

  /** Estadísticas de ingestión por mes (datamappingRecords). totalRecordsPagoValidadoDec = comparar con paymentRecords. */
  datamappingMonthStats: defineTable({
    month: v.string(),
    totalRecords: v.number(),
    totalRecordsPagoValidado: v.optional(v.number()),
    totalRecordsPagoValidadoDec: v.optional(v.number()),
    daysWithData: v.number(),
    byDate: v.array(v.object({ date: v.string(), count: v.number() })),
    lastUpdated: v.number(),
  }).index("by_month", ["month"]),

  /** Igual que datamappingMonthStats pero agrupado por fechaTransaccionMexico (mes del pago). Usado para comparación con paymentRecords (mes del pago). */
  datamappingMonthStatsByFechaTransaccion: defineTable({
    month: v.string(),
    totalRecords: v.number(),
    totalRecordsPagoValidado: v.optional(v.number()),
    totalRecordsPagoValidadoDec: v.optional(v.number()),
    daysWithData: v.number(),
    byDate: v.array(v.object({ date: v.string(), count: v.number() })),
    /** Por día: cuenta de PAGO VALIDADO con fuente DEC. Permite mostrar DEC y PV−DEC diarios al recalcular. */
    byDatePagoValidadoDec: v.optional(v.array(v.object({ date: v.string(), count: v.number() }))),
    lastUpdated: v.number(),
  }).index("by_month", ["month"]),

  /** Jobs de pipeline: estado, progreso, resultado; para extracciones async, progreso visible tras refresh. */
  pipelineJobs: defineTable({
    jobType: v.string(),
    scope: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    progress: v.optional(
      v.object({
        current: v.number(),
        total: v.optional(v.number()),
        unit: v.optional(v.string()),
        message: v.optional(v.string()),
      })
    ),
    result: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    dependsOnJobIds: v.optional(v.array(v.id("pipelineJobs"))),
    parentJobId: v.optional(v.id("pipelineJobs")),
    externalId: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    /** Límite de unidades en paralelo para jobs paralelos; si no se setea se usa default (6). */
    maxConcurrency: v.optional(v.number()),
  })
    .index("by_startedAt", ["startedAt"])
    .index("by_status", ["status"])
    .index("by_jobType", ["jobType"]),

  /** Unidades de trabajo de un pipeline job; cola para el motor Convex. */
  pipelineJobUnits: defineTable({
    jobId: v.id("pipelineJobs"),
    unitId: v.string(),
    payload: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    result: v.optional(v.any()),
    sortOrder: v.number(),
    /** Timestamp cuando se marcó running; para detectar unidades atascadas. */
    startedAt: v.optional(v.number()),
    /** Progreso parcial mientras la unidad está running (ej. enriquecimiento: processed, enriched; fechaTransaccion: processed, updated). */
    progressDetail: v.optional(
      v.object({
        processed: v.number(),
        enriched: v.optional(v.number()),
        updated: v.optional(v.number()),
      })
    ),
  })
    .index("by_jobId", ["jobId"])
    .index("by_jobId_status", ["jobId", "status"]),

  /** Rule sets versionados por dominio (dedup, reconciliation, enrichment). Engine aplica reglas declarativas. */
  ruleSets: defineTable({
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
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
  })
    .index("by_ruleSetKey_version", ["ruleSetKey", "version"])
    .index("by_domain_source", ["domain", "sourceKey"])
    .index("by_domain_createdAt", ["domain", "createdAt"])
    .index("by_domain_source_createdAt", ["domain", "sourceKey", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  /** Eventos de auditoría por corrida/step/unit. Trazabilidad input-proceso-output. */
  auditEvents: defineTable({
    jobId: v.id("pipelineJobs"),
    eventType: v.string(),
    stepKey: v.optional(v.string()),
    unitKey: v.optional(v.string()),
    timestamp: v.number(),
    payloadSummary: v.optional(v.any()),
    resultSummary: v.optional(v.any()),
    errorCategory: v.optional(v.string()),
  }).index("by_jobId_timestamp", ["jobId", "timestamp"]),

  /** Copia fiel por fuente CloudWatch (determinístico). Una tabla por fuente para idempotencia y consolidación posterior. */
  cloudwatchSourceV1: defineTable({
    importDate: v.string(),
    importMonth: v.string(),
    logSource: v.literal("v1"),
    timestamp: v.string(),
    referencia: v.string(),
    monto: v.number(),
    fechaTransaccion: v.string(),
    estatus: v.string(),
    movimiento: v.string(),
    tramiteId: v.optional(v.number()),
    rawData: v.optional(v.string()),
  })
    .index("by_importDate", ["importDate"])
    .index("by_importMonth", ["importMonth"])
    .index("by_referencia", ["referencia"]),

  cloudwatchSourceV2: defineTable({
    importDate: v.string(),
    importMonth: v.string(),
    logSource: v.literal("v2"),
    timestamp: v.string(),
    referencia: v.string(),
    monto: v.number(),
    fechaTransaccion: v.string(),
    estatus: v.string(),
    movimiento: v.string(),
    tramiteId: v.optional(v.number()),
    rawData: v.optional(v.string()),
  })
    .index("by_importDate", ["importDate"])
    .index("by_importMonth", ["importMonth"])
    .index("by_referencia", ["referencia"]),

  cloudwatchSourcePayment: defineTable({
    importDate: v.string(),
    importMonth: v.string(),
    logSource: v.literal("payment"),
    timestamp: v.string(),
    referencia: v.string(),
    monto: v.number(),
    fechaTransaccion: v.string(),
    estatus: v.string(),
    movimiento: v.string(),
    tramiteId: v.optional(v.number()),
    rawData: v.optional(v.string()),
  })
    .index("by_importDate", ["importDate"])
    .index("by_importMonth", ["importMonth"])
    .index("by_referencia", ["referencia"]),

  /** Auditoría de ingestión CloudWatch por día: filas por etapa para diagnosticar pérdidas. */
  cloudwatchIngestionAudit: defineTable({
    date: v.string(),
    rawBySource: v.object({
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
    }),
    parsedBySource: v.object({
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
    }),
    refsKeptBySource: v.object({
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
    }),
    refsDiscardedBySource: v.object({
      v1: v.number(),
      v2: v.number(),
      payment: v.number(),
    }),
    deleted: v.number(),
    inserted: v.number(),
    skipped: v.number(),
    truncationRisk: v.boolean(),
    recordedAt: v.number(),
  }).index("by_date", ["date"]),

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
