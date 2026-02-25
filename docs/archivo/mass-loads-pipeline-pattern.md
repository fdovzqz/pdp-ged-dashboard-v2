# Patrón: Cargas masivas con motor de pipeline en Convex

Este documento describe el **motor de pipeline en Convex** que orquesta las cargas masivas de datamapping (histórico completo, clear, enriquecimiento por meses, backfill, load-from-date, fechaTransaccion, incremental) y la sincronización CloudWatch. Las unidades de trabajo se encolan en la tabla `pipelineJobUnits` y se ejecutan en **serie** (datamapping) o **paralelo** (CloudWatch por mes) mediante actions de Convex. Las actions de Convex tienen un límite de tiempo (~5 min en la práctica); por eso **todos los flujos de carga DataMapping por día o por mes** usan **fetchDatamappingForDayChunk** en bucle (proceso por chunks) para evitar timeouts en días/meses con mucho volumen. Ya no se usa Inngest para estos jobs.

Referencia de diseño: [refactor-pipeline-convex.md](refactor-pipeline-convex.md). Criterios de comparación y conjunto comparable: [reconciliation-sources-and-criteria.md](reconciliation-sources-and-criteria.md).

---

## Flujo estándar (ambas fuentes)

Para cada fuente el flujo conceptual es el mismo:

1. **Trigger:** API (Next.js) o UI crea el job y arranca el pipeline.
2. **Generación de unidades:** Según `jobType` y `scope` se generan unidades (p. ej. un mes, un rango de días).
3. **Por cada unidad:** Obtener datos → **filtrar/dedup según reglas** → escribir en tabla de registros → **actualizar stats** (por mes/día) de forma **incremental** en las mutaciones (no al final del job).
4. **Finalize:** Cuando no quedan unidades pendientes, actualizar resultado del job (progress, result, errores). No se programa recálculo de stats en el finalize; las stats se mantienen por deltas en cada upsert/delete.

---

## Filtrado y dedup

### CloudWatch → paymentRecords

- **Dedup:** En `fetchAndIngestForDate` (convex/actions.ts) se deduplica por `referencia` en memoria; prioridad **payment > v2 > v1**. Solo se guarda un registro por referencia.
- **En insert:** Si ya existe un registro con la misma `referencia` (índice `by_referencia`), se omite (skipped).
- **Filtrado en origen:** En la query de logs de tipo "payment" se filtra por estado tipo PAGO VALIDADO. Los registros que llegan a Convex ya representan pagos validados.
- **Stats:** `monthStats` se actualiza por día en la misma action (`updateMonthStatsFromDay` / upsert al insertar). No hay recálculo masivo al final del job.
- **Fechas:** Si el parser no devuelve fecha (`extractImportDate`/`extractImportMonth` vacíos), se asigna el día que se está sincronizando (y su mes) para no concentrar registros en un mes fijo.

### Datamapping → datamappingRecords

- **Dedup/upsert:** No hay dedup por referencia en ingestión. La clave única es `transactionId`; en `upsertDatamappingBatch` (convex/mutations.ts) se hace patch si existe, insert si no.
- **Stats:** En jobs paralelos (full_history, sync_by_months, sync_by_range) se usa `skipStatsUpdate: true` durante la ingesta para evitar OCC; al **finalize** se programa la action `getDatamappingIngestionStats` para recalcular stats. En ingestas no paralelas las stats se actualizan por lote.
- **Conjunto comparable:** Para reconciliación y agregados (ETL) se usa solo `status === "PAGO VALIDADO"` en las queries. La carga desde DynamoDB no filtra por status; el filtro es al leer.

Ver [reconciliation-sources-and-criteria.md](reconciliation-sources-and-criteria.md) para el conjunto comparable y criterio de mes.

---

## Objetivos del patrón

1. **Sin límite 5 min de Vercel**: el trabajo pesado corre solo en Convex; la API Next solo crea el job y llama a `startPipelineJob`.
2. **Proceso por chunks (DataMapping)**: para evitar el corte ~5 min de las actions, **sync por rango**, **sync por meses** e **histórico completo** procesan cada día con **fetchDatamappingForDayChunk** en bucle (varias llamadas cortas por día). Un mes se procesa día a día; un día con mucho volumen (p. ej. 2024-05-04) no supera el límite porque cada chunk es una action corta.
3. **Visibilidad**: progreso y resultado en `pipelineJobs` (progress.current/total, result con completedMonths/failedMonths, byDate, byMonth). Errores con mensaje real en `errorMessage` y en `result.failedDays`/`result.failedMonths`; la UI muestra diagnóstico (durationMs, chunkCount, inserted, updated) en Audit y en Unidades fallidas.
4. **Cancelación**: `cancelPipelineJob(jobId)` marca el job como cancelled; el motor no programa más unidades.

---

## Componentes

### 1. Tabla `pipelineJobUnits`

- `jobId`, `unitId`, `payload`, `status` (pending | running | completed | failed), `result`, `sortOrder`.
- Índices: `by_jobId`, `by_jobId_status`.
- El motor inserta las unidades al arrancar y las va marcando completed/failed según terminan.

### 2. Mutations (en `convex/pipelineRunnerMutations.ts`)

- **startPipelineJob(jobId)**: lee el job, genera unidades según `jobType`, inserta en `pipelineJobUnits`, marca job running, programa las primeras N unidades (N = min(`maxConcurrency` del job o 6, unidades pendientes)) para jobs paralelos, o la primera para jobs en serie.
- **reportPipelineUnitComplete(jobId, unitId, result, failed?)**: marca la unidad completed/failed, actualiza progress; si quedan pendientes programa hasta llenar el pool (paralelo) o la siguiente (serie); si no quedan pendientes ejecuta **finalize**.
- **recoverStuckPipelineUnits(jobId)**: marca como failed las unidades en "running" más de 30 min y programa siguientes o finalize (recuperación ante timeouts).
- **setPipelineJobConcurrency(jobId, maxConcurrency)**: ajusta el límite de workers en caliente; si el job está running programa más unidades hasta el nuevo límite.
- **cancelPipelineJob(jobId)**: pone el job en status cancelled.

### 3. Action (en `convex/pipelineRunner.ts`, "use node")

- **processPipelineUnit(jobId, unitId)**: carga la unidad y el job; si job cancelled sale; marca la unidad running; ejecuta la lógica de la unidad según jobType (llamando a actions existentes en bucle si hace falta); llama a `reportPipelineUnitComplete` con el resultado o con error.

### 4. Flujo por jobType

Cada jobType tiene:

- **Generador de unidades**: de `scope` → lista de `{ unitId, payload, sortOrder }` (p. ej. full-history: rangos de 3 días por mes; enrichment: una unidad por mes).
- **Ejecutor**: dentro de `processPipelineUnit`, switch por jobType que invoca el handler correspondiente (en `convex/lib/unitHandlers.ts`). Para DataMapping, **sync por rango**, **sync por meses** e **histórico completo** usan un helper común `syncOneDayWithChunks` que hace bucle de `fetchDatamappingForDayChunk` por día; así ningún día ni mes supera el límite de tiempo de la action.
- **Finalizer**: en `reportPipelineUnitComplete`, cuando no quedan pendientes, se agregan resultados por mes, se llama a setDatamappingWatermark/clearDatamappingWatermark cuando aplique, y updatePipelineJobResult/updatePipelineJobError.

---

## Checklist común (por fuente)

Para cada job de carga:

1. **Trigger:** API/UI crea el job (`createPipelineJob`) y llama a `startPipelineJob`.
2. **Unidades:** Se generan según jobType (p. ej. una por mes, una por rango de días).
3. **En cada unidad:** fetch → filtrar/dedup según reglas de la fuente → escribir en tabla → **actualizar stats en la misma mutación** (monthStats para CW por día; datamappingIngestionStats por deltas en upsert/delete).
4. **Finalize:** Marcar job completed/failed, escribir result en pipelineJobs. No se recalcula stats en el finalize.

---

## Jobs implementados

| jobType | Fuente | Unidades | Ejecutor | Finalizer |
|---------|--------|----------|----------|-----------|
| cloudwatch_sync_by_range | CW | **Una por día** (rango fecha inicio–fin) | fetchAndIngestForDate por día, skipMonthStatsUpdate | byDate, watermark, recreateAllMonthStats |
| cloudwatch_sync_by_months | CW | Por mes (rangos 3 días por mes) | fetchAndIngestForDate por día en cada rango | byMonth, watermark, recreateAllMonthStats |
| datamapping_sync_by_range | DDB | **Una por día** (rango fecha inicio–fin) | **Bucle fetchDatamappingForDayChunk por día** (evita timeout ~5 min) | byDate, getDatamappingIngestionStats |
| datamapping_sync_by_months | DDB | Una por mes | **Bucle fetchDatamappingForDayChunk día a día** dentro del mes (mismo patrón que sync_by_range) | byMonth, getDatamappingIngestionStats |
| datamapping_full_history | DDB | Rangos 3 días por mes | Bucle fetchDatamappingForDayChunk por rango | byMonth, watermark, getDatamappingIngestionStats |
| datamapping_clear | DDB | 1 | Bucle deleteDatamappingRecordsBatch | clearDatamappingWatermark, clearDatamappingIngestionStats, updatePipelineJobResult |
| datamapping_enrichment_by_months | DDB | Una por mes | enrichDatamappingWithRfc en bucle con continueState | byMonth, completedMonths, failedMonths |
| datamapping_backfill_enrichment_by_months | DDB | Una por mes | backfillDatamappingEnrichmentExtractedForRange en bucle | byMonth, getDatamappingIngestionStats |
| datamapping_load_from_date | DDB | 1 | fetchDatamappingAndIngest en bucle (por páginas); result incluye **byDate** (registros por día) para la UI | updatePipelineJobResult (con byDate) |
| datamapping_fecha_transaccion_full | DDB | Una por mes, o **por rango de fechas** si `scope.startDate`/`scope.endDate` | backfillFechaTransaccionForMonth en bucle, o runFechaTransaccionChunk por bloque de 3 días | byMonth o by chunk, completedMonths, failedMonths |
| datamapping_fecha_transaccion_from_date | DDB | 1 | backfillFechaTransaccionForDatamapping en bucle | updatePipelineJobResult |
| datamapping_incremental | DDB | 1 | fetchDatamappingIncremental | updatePipelineJobResult |

---

## API

Las rutas POST bajo `/api/datamapping/*` (full-history, clear, enrich-by-months, etc.) crean un documento en `pipelineJobs` con `createPipelineJob` y luego llaman a la mutation `startPipelineJob` con el nuevo jobId. La UI sigue leyendo `pipelineJobs` con las mismas queries (getLatestDatamappingFullHistoryJob, listPipelineJobs, getPipelineJob).

Para **datamapping_fecha_transaccion_full**, la ruta `POST /api/datamapping/fecha-transaccion-full` acepta body opcional `{ startDate?, endDate? }` (YYYY-MM-DD). Si se envían ambos, el job se crea con `scope: { mode: "full", startDate, endDate }` y solo se generan unidades de 3 días en ese rango (para reintentar bloques fallidos sin ejecutar todo el histórico).

---

## Reintentos ante OCC

Cuando muchas unidades actualizan progreso o se marcan completadas a la vez, Convex puede devolver errores de concurrencia optimista (OCC). El mensaje en el log corresponde a un intento fallido; la action reintenta con backoff y en la práctica suele recuperarse. Detalle de causa y recuperación: [07-observabilidad-reintentos-y-recuperacion.md](../07-observabilidad-reintentos-y-recuperacion.md#reintentos-ante-occ-convex).

Para no marcar unidades como fallidas por OCC:

- **reportPipelineUnitComplete**: se llama desde la action mediante `reportUnitCompleteWithRetry` (reintentos con backoff).
- **updatePipelineUnitProgress**: los handlers llaman a la action `updatePipelineUnitProgressWithRetry`, que reintenta la mutation ante OCC. Definida en `convex/pipelineActions.ts`; usada desde `convex/lib/unitHandlers.ts` en todos los jobTypes que actualizan progreso (enriquecimiento, load-from-date, fechaTransaccion full/from_date).

---

## Resumen

- **Motor 100% en Convex**: cola en `pipelineJobUnits`, mutations para arrancar y reportar, action para ejecutar cada unidad.
- **Unidad = trabajo acotado** (3 días, 1 mes, 1 job único) para no superar 10 min por action.
- **Resultado en pipelineJobs**: completedMonths, failedMonths, byMonth, summary; si hay fallos, errorMessage con resumen.
- **Inngest** ya no se usa para estos pipelines; la ruta `/api/inngest` puede conservar solo testPing para pruebas.
