# Convención de nombres de tablas Convex

Objetivo: que el **inicio del nombre** indique el **dominio o uso** (fuente, agregación, ETL, pipeline, reconciliación, configuración).

## Prefijos por dominio/uso

| Prefijo | Uso | Ejemplo |
|---------|-----|---------|
| **cloudwatch** | Fuente y estadísticas de CloudWatch (paymentRecords, monthStats, ingestionStats) | `cloudwatchPaymentRecords`, `cloudwatchMonthStats`, `cloudwatchIngestionStats` *(a crear)* |
| **cloudwatchAgg** | Agregados para dashboard (origen CloudWatch) | `cloudwatchAggRawHourly`, `cloudwatchAggDailyData` |
| **datamapping** | Fuente y estadísticas de DataMapping (DynamoDB → Convex) | `datamappingRecords`, `datamappingMonthStats` |
| **datamappingAgg** | Agregados para dashboard (origen DataMapping) | `datamappingAggRawHourly`, `datamappingAggDailyData` |
| **pipeline** | Jobs, unidades y auditoría del motor de pipeline | `pipelineJobs`, `pipelineJobUnits`, `pipelineAuditEvents` |
| **reconciliation** | Resultados de reconciliación CW vs DDB | `reconciliationSummary`, `reconciliationErrors` |
| **etl** | Control y corridas ETL (watermarks, runs) | `etlProcessingControl`, `etlRfcEnrichmentRuns` |
| **config** | Datos de configuración / referencia editables | `configMovementCodes`, `configRuleSets` |
| **app** | Datos de aplicación/UI (notas, etc.) | `appAnalysisNotes` |

## Mapeo: nombre actual → nombre propuesto

### Fuentes y estadísticas CloudWatch
| Actual | Propuesto | Notas |
|--------|-----------|--------|
| `paymentRecords` | `cloudwatchPaymentRecords` | Registros de pagos desde logs CW (v1, v2, payment) |
| `monthStats` | `cloudwatchMonthStats` | Estadísticas precalculadas por mes (dayEntries, kpis, ingestionStatus por mes) |
| *(no existe)* | `cloudwatchIngestionStats` | **Espejo de `datamappingIngestionStats`**: una sola fila con total, byYear, byMonth, byDay (por `importMonth`/`importDate`). Hoy los totales globales CW se obtienen agregando `monthStats`; esta tabla materializaría el mismo patrón que DataMapping para comparación y UI. |

### Agregados CloudWatch (dashboard)
| Actual | Propuesto |
|--------|-----------|
| `rawHourlyData` | `cloudwatchAggRawHourly` |
| `dailyData` | `cloudwatchAggDailyData` |
| `monthlyData` | `cloudwatchAggMonthlyData` |
| `hourlyDistribution` | `cloudwatchAggHourlyDistribution` |
| `dailyAmountData` | `cloudwatchAggDailyAmount` |
| `amountByMovement` | `cloudwatchAggAmountByMovement` |

### Fuente y estadísticas DataMapping
| Actual | Propuesto | Notas |
|--------|-----------|--------|
| `datamappingRecords` | *(ya alineado)* `datamappingRecords` | Espejo: `cloudwatchPaymentRecords` |
| `datamappingMonthStats` | *(ya alineado)* `datamappingMonthStats` | Espejo: `cloudwatchMonthStats` |
| `datamappingIngestionStats` | *(ya alineado)* `datamappingIngestionStats` | Espejo: `cloudwatchIngestionStats` *(a crear)* |

### Agregados DataMapping (dashboard)
| Actual | Propuesto |
|--------|-----------|
| `rawHourlyDataDatamapping` | `datamappingAggRawHourly` |
| `dailyDataDatamapping` | `datamappingAggDailyData` |
| `monthlyDataDatamapping` | `datamappingAggMonthlyData` |
| `hourlyDistributionDatamapping` | `datamappingAggHourlyDistribution` |
| `dailyAmountDataDatamapping` | `datamappingAggDailyAmount` |
| `amountByMovementDatamapping` | `datamappingAggAmountByMovement` |
| `datamappingDailyFuenteBreakdown` | `datamappingAggDailyFuenteBreakdown` |
| `datamappingDailySourceBreakdown` | `datamappingAggDailySourceBreakdown` |

### Pipeline
| Actual | Propuesto |
|--------|-----------|
| `pipelineJobs` | *(ya alineado)* `pipelineJobs` |
| `pipelineJobUnits` | *(ya alineado)* `pipelineJobUnits` |
| `auditEvents` | `pipelineAuditEvents` |

### Reconciliación
| Actual | Propuesto |
|--------|-----------|
| `reconciliationSummary` | *(ya alineado)* `reconciliationSummary` |
| `reconciliationErrors` | *(ya alineado)* `reconciliationErrors` |

### ETL / control y corridas
| Actual | Propuesto |
|--------|-----------|
| `processingControl` | `etlProcessingControl` |
| `rfcEnrichmentRuns` | `etlRfcEnrichmentRuns` |
| `rfcInvestigationResults` | `etlRfcInvestigationResults` (o `datamappingRfcInvestigationResults` si se quiere atar al dominio) |

### Configuración
| Actual | Propuesto |
|--------|-----------|
| `movementCodes` | `configMovementCodes` |
| `movementAliases` | `configMovementAliases` |
| `ruleSets` | `configRuleSets` |

### App / UI
| Actual | Propuesto |
|--------|-----------|
| `analysisNotes` | `appAnalysisNotes` |

---

## Cómo aplicar (migración)

Convex **no renombra tablas** en caliente. Opciones:

1. **Solo convención para tablas nuevas**  
   Dejar nombres actuales; usar esta convención en tablas que se creen a partir de ahora.

2. **Migración completa**  
   - Añadir en el schema las nuevas tablas con nombres propuestos.  
   - Crear jobs/scripts que lean de la tabla antigua y escriban en la nueva (por lotes).  
   - Actualizar todo el código para usar las nuevas tablas (`Id<"nuevaTabla">`, `ctx.db.query("nuevaTabla")`, etc.).  
   - Eliminar tablas antiguas del schema cuando estén vacías y ya no se usen.

Si quieres, el siguiente paso puede ser: (a) aplicar solo a tablas nuevas, o (b) definir un plan de migración por fases (por ejemplo: primero cloudwatch, luego datamapping, luego pipeline/config).
