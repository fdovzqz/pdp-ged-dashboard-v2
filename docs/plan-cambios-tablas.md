# Plan de cambios de tablas – Pruebas integrales

Objetivo: dejar el sistema listo para **pruebas integrales con el nuevo modelo de operación**: tablas de datos marcadas para borrar (limpieza previa a pruebas) y tablas de configuración con **scripts de migración** (export/import) para preservar o re-aplicar config al renombrar tablas.

Referencia de nombres actuales y propuestos (espejo CloudWatch/DataMapping): **`docs/convencion-nombres-tablas.md`**.

---

## 1. Clasificación de tablas

### 1.1 Tablas de datos – **se pueden borrar** para pruebas integrales

Datos cargados o derivados por carga, limpieza, dedup, enriquecimiento, agregación o reconciliación. Se marcan para **borrado** antes de correr pruebas desde cero.

| Tabla | Origen del dato | Orden de borrado |
|-------|------------------|------------------|
| `reconciliationErrors` | Reconciliación CW vs DDB | 1 |
| `reconciliationSummary` | Reconciliación | 2 |
| `auditEvents` | Pipeline (referencia `pipelineJobs`) | 3 |
| `pipelineJobUnits` | Pipeline (referencia `pipelineJobs`) | 4 |
| `pipelineJobs` | Pipeline | 5 |
| `rfcInvestigationResults` | ETL investigación RFC | 6 |
| `rfcEnrichmentRuns` | ETL enriquecimiento | 7 |
| `datamappingIngestionStats` | ETL DataMapping | 8 |
| `datamappingMonthStats` | ETL DataMapping | 9 |
| `datamappingRecords` | Carga DataMapping (DynamoDB → Convex) | 10 |
| `processingControl` | Watermarks y control ETL (cloudwatch_watermark, datamapping_watermark, etc.) | 11 |
| `paymentRecords` | Carga CloudWatch (logs → Convex) | 12 |
| `monthStats` | Estadísticas por sincronización CloudWatch | 13 |
| `rawHourlyData` | Agregados CloudWatch | 14 |
| `dailyData` | Agregados CloudWatch | 15 |
| `monthlyData` | Agregados CloudWatch | 16 |
| `hourlyDistribution` | Agregados CloudWatch | 17 |
| `dailyAmountData` | Agregados CloudWatch | 18 |
| `amountByMovement` | Agregados CloudWatch | 19 |
| `rawHourlyDataDatamapping` | Agregados DataMapping | 20 |
| `dailyDataDatamapping` | Agregados DataMapping | 21 |
| `monthlyDataDatamapping` | Agregados DataMapping | 22 |
| `hourlyDistributionDatamapping` | Agregados DataMapping | 23 |
| `dailyAmountDataDatamapping` | Agregados DataMapping | 24 |
| `amountByMovementDatamapping` | Agregados DataMapping | 25 |
| `datamappingDailyFuenteBreakdown` | Agregados DataMapping | 26 |
| `datamappingDailySourceBreakdown` | Agregados DataMapping | 27 |

El orden respeta dependencias: primero reconciliación y pipeline (audit → units → jobs), luego ETL/datamapping, watermarks, fuente CloudWatch, estadísticas y por último agregados.

**Nota:** No existe aún la tabla espejo `cloudwatchIngestionStats` (ver convención de nombres). Cuando se implemente, se incluirá en esta lista de tablas de datos, en el mismo bloque conceptual que `monthStats` (estadísticas CloudWatch), y la limpieza deberá borrarla igual que `datamappingIngestionStats`.

### 1.2 Tablas de configuración – **migración (export/import)**

Configuración de la operación. No se borran para pruebas; se **exportan** a JSON y se pueden **re-importar** tras un renombrado de tablas (ver `docs/convencion-nombres-tablas.md`).

| Tabla | Uso | Script |
|-------|-----|--------|
| `movementCodes` | Códigos y descripciones de movimientos | Export/import en `scripts/config-export.ts`, `scripts/config-import.ts` |
| `movementAliases` | Alias → código canónico | Idem |
| `ruleSets` | Reglas (dedup, reconciliation, enrichment) | Idem |
| `analysisNotes` | Notas de análisis (UI) | Idem |

---

## 2. Limpieza de tablas de datos (pre-pruebas integrales)

### 2.1 Opción A – Acción interna (recomendada)

Módulo **`convex/internalDataCleanup.ts`** con una **internal action** que ejecuta la limpieza en el orden anterior:

- Reconciliación: `clearReconciliationBatch` en bucle.
- Pipeline: borrar en lotes `auditEvents`, `pipelineJobUnits`, `pipelineJobs` (internal mutations).
- ETL: borrar `rfcInvestigationResults`, `rfcEnrichmentRuns`; `clearDatamappingIngestionStats`; borrar `datamappingMonthStats` y `datamappingRecords` por lotes; borrar `processingControl`.
- Watermarks: `clearDatamappingWatermark`, `clearCloudwatchWatermark`.
- CloudWatch: borrar `paymentRecords` por mes (`deletePaymentsByMonth` en bucle); borrar `monthStats` por lotes.
- Agregados: `clearAggregatesForMonth` y `clearDatamappingAggregatesForMonth` para cada mes (lista de meses obtenida de `getAllMonthsStatus` al inicio).

Invocación desde CLI:

```bash
npx convex run internalDataCleanup:prepareForIntegralTesting
```

(La acción puede tener límite de tiempo en entornos con muchos datos; si hace falta, ejecutar de nuevo o dividir en pasos.)

### 2.2 Opción B – Usar jobs de pipeline existentes + limpieza manual del resto

- Ejecutar job **datamapping_clear** (limpia `datamappingRecords`, watermark e ingestion stats; ver unit handler).
- Ejecutar job **cloudwatch_clear** para los meses que se quieran resetear (limpia `paymentRecords` y `monthStats` de esos meses y watermark).
- Limpiar el resto a mano o con un script que llame: `clearReconciliationBatch` en bucle, borrado de `pipelineJobs`/`pipelineJobUnits`/`auditEvents`, `rfc*`, `processingControl`, agregados CW/DM por mes.

En este caso no se añade `internalDataCleanup`; el plan se documenta y se ejecuta desde dashboard o scripts que llamen a las mutaciones públicas.

---

## 3. Scripts de migración de configuración

Objetivo: exportar configuración a JSON y poder importarla de nuevo (mismo esquema o, en el futuro, tablas renombradas).

### 3.1 Export

- **Script:** `scripts/config-export.ts`
- **Uso:** `pnpm run config:export` o `pnpm run config:export -- --out scripts/data/config-export.json`
- **Acción:** Lee `movementCodes`, `movementAliases`, `ruleSets` (con reglas completas vía `getRuleSet`), `analysisNotes` y escribe JSON en `scripts/data/config-export.json` (documentos sin `_id` para re-import).

### 3.2 Import

- **Script:** `scripts/config-import.ts`
- **Uso:** `pnpm run config:import` o `pnpm run config:import -- --file scripts/data/config-export.json`
- **Acción:** Lee el JSON exportado y llama las mutaciones públicas de upsert/insert por tabla (`upsertMovementCode`, `upsertMovementAlias`, `insertRuleSet`, `upsertAnalysisNote`).

Cuando se aplique el renombrado de tablas (`configMovementCodes`, etc.), el import usará mutaciones que escriban en las nuevas tablas.

---

## 4. Orden recomendado para “dejar listo” para pruebas integrales

1. **Exportar configuración** (por si hace falta restaurar después):
   ```bash
   pnpm run config:export
   ```
2. **Ejecutar limpieza de tablas de datos** (Opción A: `npx convex run internalDataCleanup:prepareForIntegralTesting` o Opción B en el plan).
3. **(Opcional)** Verificar que las tablas de datos están vacías (queries desde dashboard o script).
4. Ejecutar **pruebas integrales** con el nuevo modelo de operación (carga, dedup, enriquecimiento, agregación, reconciliación, pipeline).

Después de pruebas, si se desea **restaurar** configuración desde el export:

```bash
pnpm run config:import -- --file scripts/data/config-export.json
```

---

## 5. Renombrado futuro de tablas (post-pruebas)

Cuando se aplique la convención de nombres (`docs/convencion-nombres-tablas.md`):

1. Añadir al schema las **nuevas tablas** con nombres estándar.
2. Para **config**: usar el JSON exportado; crear mutaciones que escriban en las nuevas tablas y ejecutar `config-import` apuntando a esas mutaciones (o un script que lea el JSON y llame inserts en las tablas nuevas).
3. Para **datos**: si se migran (no solo “borrar y volver a cargar”), crear jobs o scripts que lean de la tabla antigua y escriban en la nueva por lotes; luego actualizar código a las nuevas tablas y eliminar las antiguas del schema.

Este plan no incluye el renombrado en sí; solo deja listas la clasificación, la limpieza y la migración de configuración para poder arrancar las pruebas integrales.
