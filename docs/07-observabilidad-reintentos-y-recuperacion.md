# Observabilidad, reintentos y recuperacion

## Estandar de observabilidad

## Eventos obligatorios por ciclo de vida

- `run.created`
- `run.started`
- `step.started`
- `unit.started`
- `unit.completed`
- `unit.failed`
- `retry.scheduled`
- `step.completed`
- `run.completed`
- `run.failed`

## Payload minimo por evento

- `runId`
- `workflowKey`
- `workflowVersion`
- `stepKey`
- `unitKey` — identifica la unidad (p. ej. fecha `2024-01-15` en jobs por rango; se muestra en el log de auditoría).
- `timestamp`
- `status`
- `inputSummary`
- `outputSummary`
- `error` (si aplica)
- `correlationId`

En la UI de detalle de run (`/operaciones/runs/[id]`), cada evento `unit.completed` / `unit.failed` muestra el `unitKey` y, cuando existe resultado de la unidad, el conteo de registros (ins/upd/del o procesados) para ese día o unidad.

## Metricas operativas minimas

### Ejecucion

- duracion por run/step/unit
- throughput por etapa
- unidades pendientes/running/failed

### Calidad

- porcentaje de checks en pass/warn/fail
- tasa de registros invalidos
- drift de reconciliacion

### Confiabilidad

- retry rate
- failure rate por categoria
- mean time to recovery

## Alertamiento

Alertas prioritarias:

- corrida fallida
- step critico en fail
- retries por encima de umbral
- unidad atascada sobre timeout extendido
- diferencia de reconciliacion fuera de tolerancia

## Politica de reintentos

- errores transitorios: reintento automatico con backoff.
- errores permanentes: fail inmediato con evidencia.
- errores desconocidos: retry acotado y escalamiento.

## Reintentos ante OCC (Convex)

Cuando muchas unidades del pipeline terminan o actualizan progreso a la vez, Convex puede devolver **Optimistic Concurrency Control (OCC)** ([error #1](https://docs.convex.dev/error#1)): el mensaje indica que documentos leídos o escritos en `pipelineJobUnits` o `pipelineJobs` cambiaron durante la mutación.

**Por qué ocurre:** En jobs paralelos (p. ej. `datamapping_sync_by_months`) varias unidades pueden completarse casi al mismo tiempo. Cada una invoca `reportPipelineUnitComplete`, que lee el mismo documento de `pipelineJobs` (y sus unidades) y luego hace `patch` sobre ese documento. Convex serializa las mutaciones y, si entre la lectura y la escritura otro commit ya modificó el documento, la mutación que llega después falla con *"Documents read from or written to the pipelineJobs table changed..."*. El ID que aparece en el mensaje es el del documento de `pipelineJobs` que cambió durante la ejecución.

Sin reintentos, la unidad quedaría marcada como fallida aunque el trabajo se haya ejecutado correctamente. **Los reintentos suelen recuperar:** el mensaje en el log corresponde a un intento fallido; la action reintenta hasta 8 veces con backoff y en la práctica uno de los reintentos suele tener éxito cuando ya no hay tanta concurrencia sobre el mismo documento.

Para mitigarlo:

- **reportPipelineUnitComplete**: se invoca desde la action `processPipelineUnit` mediante `reportUnitCompleteWithRetry` (en `convex/pipelineActions.ts`). Ante errores que incluyan "Documents read from or written to" o "changed while this mutation" se reintenta con backoff (hasta 8 intentos, delay base 800 ms, máximo 15 s).
- **updatePipelineUnitProgress**: los handlers en `convex/lib/unitHandlers.ts` llaman a la action `updatePipelineUnitProgressWithRetry`, que a su vez invoca la mutation `updatePipelineUnitProgress` con el mismo esquema de reintentos (hasta 8 intentos, delay base 500 ms, máximo 15 s).

`isRetryableError` en `pipelineActions.ts` considera retry para: `OptimisticConcurrencyControlFailure`, `CommitterFullError`, `Too many concurrent commits`, y los mensajes de documento modificado durante la mutación.

## Límite de tiempo de actions y proceso por chunks

Las actions de Convex tienen un límite de tiempo en la práctica (~5 min); si una action tarda más, se interrumpe sin mensaje de error explícito. Para evitarlo, **todos los flujos de carga DataMapping** (sync por rango, sync por meses, histórico completo) procesan cada día con **fetchDatamappingForDayChunk** en bucle (varias actions cortas por día). Un mes se procesa día a día con el mismo patrón. Así no se supera el límite ni en días ni en meses con mucho volumen. Ver [archivo/mass-loads-pipeline-pattern.md](archivo/mass-loads-pipeline-pattern.md). Cuando una unidad falla, el resultado incluye diagnóstico (durationMs, chunkCount, inserted, updated) en Audit y en la sección "Unidades fallidas"; si no hay mensaje de error (p. ej. timeout), la UI muestra un texto de fallback indicando revisar logs de Convex.

## Vista Run Detail (detalle de corrida)

En `/operaciones/runs/[id]` se expone:

- **Scope y progreso:** parámetros del job y unidades completadas / total.
- **Error:** mensaje real del fallo (incl. detalle por día o por mes cuando aplica); si no hay mensaje (p. ej. timeout), texto de fallback.
- **Unidades fallidas:** lista con botón "Reintentar todas"; cada unidad muestra diagnóstico (error, durationMs, chunkCount, inserted, updated) cuando está disponible.
- **Unidades completadas y pendientes:** listas explícitas de días (o unidades) que ya corrieron y las que no, para saber qué re-ejecutar si el job se canceló o falló a mitad.
- **Registros procesados:** tabla por día/unidad con insertados, actualizados y eliminados (según el tipo de job); totales en la parte superior. Los valores provienen de `pipelineJobUnits.result` (inserted, updated, deleted, processed).
- **Registros por día (load_from_date):** para jobs `datamapping_load_from_date`, una sección adicional con desglose por fecha (byDate) igual que en los otros procesos de carga.
- **Auditoría:** log de eventos (`run.started`, `unit.completed`, `unit.failed`, etc.) con `unitKey` y conteo de registros por evento cuando está disponible; para unidades fallidas con diagnóstico se muestra durationMs, batchCount/chunkCount y error.

## Recuperacion operacional

## Modo automatico

- recover de unidades atascadas por TTL.
- relleno de pendientes detectados por scan.

## Modo asistido

- rerun parcial por step/unidad.
- rerun completo idempotente.
- cancelacion y replanificacion de corrida.

## Dashboard operativo (minimo)

Paneles recomendados:

1. Estado global de corridas.
2. Progreso por workflow y version.
3. Errores por categoria y fuente.
4. Salud de calidad por etapa.
5. Backlog de pendientes y recuperacion.
