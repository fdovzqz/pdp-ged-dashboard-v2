# Refactor: Motor de pipeline en Convex y migración desde Inngest

Este documento describe la **nueva arquitectura** (orquestación de jobs de pipeline 100% en Convex, sin Inngest) y los **pasos concretos** para migrar el comportamiento actual. Usar en una sesión dedicada de refactor e implementación.

---

## 1. Objetivo

- **Eliminar la dependencia de Inngest** para los jobs de carga, limpieza, enriquecimiento, agregación y reconciliación.
- **Un solo motor de pipeline en Convex** reutilizable: cola de unidades, ejecución en actions (límite 10 min por unidad), progreso y resultado en `pipelineJobs`.
- **Sin límite de 5 min de Vercel**: el trabajo pesado corre solo en Convex; la API solo dispara el inicio.
- **Misma experiencia de UI**: la página de Jobs y las pantallas de “Carga de fuentes” siguen leyendo `pipelineJobs` (queries existentes); no se rompe el contrato de `jobType`, `scope`, `progress`, `result`, `errorMessage`.

---

## 2. Estado actual

### 2.1 Arquitectura actual

- **Trigger**: rutas Next.js (`POST /api/datamapping/full-history`, `/clear`, `/enrich-by-months`, etc.) crean un documento en `pipelineJobs` y envían un **evento Inngest**.
- **Ejecución**: funciones Inngest (en Vercel) ejecutan steps; cada step puede llamar a Convex (actions/mutations) en bucle. Límite **5 min por invocación** en Vercel.
- **Progreso**: las funciones Inngest actualizan `pipelineJobs` vía `updatePipelineJobProgress`, `updatePipelineJobResult`, `updatePipelineJobError`.
- **UI**: consulta `getLatestDatamappingFullHistoryJob`, `getLatestDatamappingClearJob`, `getLatestFechaTransaccionFullJob`, `listPipelineJobs`, `getPipelineJob`. Todo desde Convex.

### 2.2 Jobs que hoy usan Inngest

| jobType | Evento Inngest | Archivo Inngest | Unidad de trabajo | Notas |
|---------|----------------|-----------------|-------------------|--------|
| `datamapping_full_history` | `reconciliation/datamapping.full-history` | `datamapping-full-history.ts` | Rangos de 3 días por mes | Muchos steps; mayo 2024 puede timeout |
| `datamapping_clear` | `reconciliation/datamapping.clear` | `datamapping-clear.ts` | Un solo step (borrar lotes) | Un step largo; podría timeout con muchos registros |
| `datamapping_enrichment_by_months` | `reconciliation/datamapping.enrich-by-months` | `datamapping-enrichment-by-months.ts` | Un step por mes | Paralelo por mes |
| `datamapping_backfill_enrichment_by_months` | `reconciliation/datamapping.backfill-enrich-by-months` | `datamapping-backfill-enrichment-by-months.ts` | Un step por mes | Paralelo por mes |
| `datamapping_load_from_date` | `reconciliation/datamapping.load-from-date` | `datamapping-load-from-date.ts` | Un step (carga desde fecha) | Un solo step |
| `datamapping_fecha_transaccion_full` | `reconciliation/datamapping.fecha-transaccion-full` | `datamapping-fecha-transaccion-full.ts` | Un step por mes | Paralelo por mes |
| `datamapping_fecha_transaccion_from_date` | `reconciliation/datamapping.fecha-transaccion-from-date` | `datamapping-fecha-transaccion-from-date.ts` | Un step | Un solo step |
| `datamapping_incremental` | (cron o manual) | `datamapping-incremental.ts` | Un step | Carga incremental |
| — | `inngest/function.cancelled` | `pipeline-job-cancelled-handler.ts` | — | Actualiza job a `cancelled` cuando Inngest cancela |

### 2.3 Rutas API que disparan jobs

| Ruta | Crea jobType | Envía evento Inngest |
|------|--------------|----------------------|
| `POST /api/datamapping/full-history` | `datamapping_full_history` | `reconciliation/datamapping.full-history` |
| `POST /api/datamapping/clear` | `datamapping_clear` | `reconciliation/datamapping.clear` |
| `POST /api/datamapping/enrich-by-months` | `datamapping_enrichment_by_months` | `reconciliation/datamapping.enrich-by-months` |
| `POST /api/datamapping/backfill-enrichment-by-months` | `datamapping_backfill_enrichment_by_months` | (evento correspondiente) |
| `POST /api/datamapping/load-from-date` | `datamapping_load_from_date` | `reconciliation/datamapping.load-from-date` |
| `POST /api/datamapping/full-history` (fecha-transaccion full) | `datamapping_fecha_transaccion_full` | (evento correspondiente) |
| `POST /api/datamapping/fecha-transaccion-from-date` | `datamapping_fecha_transaccion_from_date` | (evento correspondiente) |

### 2.4 Archivos relevantes actuales

- **Convex**: `convex/pipelineJobs.ts`, `convex/schema.ts` (tabla `pipelineJobs`), `convex/actions.ts` (`fetchDatamappingForDayChunk`, `fetchDatamappingForMonth`, etc.).
- **Inngest**: `src/inngest/client.ts`, `src/app/api/inngest/route.ts`, y los 10 archivos en `src/inngest/*.ts` listados arriba.
- **API**: `src/app/api/datamapping/full-history/route.ts`, `clear/route.ts`, `enrich-by-months/route.ts`, etc.
- **UI**: `src/app/configuracion/carga-fuentes/page.tsx`, `src/app/configuracion/status/page.tsx` (usan `getLatestDatamappingFullHistoryJob`, `getLatestDatamappingClearJob`, `getLatestFechaTransaccionFullJob`, `listPipelineJobs`, `getPipelineJob`).

---

## 3. Arquitectura objetivo

### 3.1 Flujo genérico

```
API (Next)                    Convex
   |                             |
   |  createPipelineJob          |
   |  startPipelineJob(jobType,  |
   |    scope)                   |
   |---------------------------->|
   |                             |  Genera unidades según jobType
   |                             |  Guarda cola (pendingUnits)
   |                             |  updatePipelineJobProgress(running)
   |                             |  scheduler.runAfter(0, processPipelineUnit, { jobId, unit1 })
   |<----------------------------|  200 { jobId }
   |                             |
   |                             |  processPipelineUnit(jobId, unit)
   |                             |    -> ejecuta action según jobType (ej. fetchDatamappingForDayChunk loop)
   |                             |    -> reportPipelineUnitComplete(jobId, unitId, result)
   |                             |
   |                             |  reportPipelineUnitComplete
   |                             |    -> pendingUnits--, completedResults.push(result)
   |                             |    -> updatePipelineJobProgress(current, total)
   |                             |    -> si quedan unidades: runAfter(0, processPipelineUnit, nextUnit)
   |                             |    -> si no: finalizePipelineJob(jobType, jobId, completedResults)
   |                             |         -> agregar por mes, watermark, etc.
   |                             |         -> updatePipelineJobResult / updatePipelineJobError
```

- **startPipelineJob**: mutation. Crea la cola de unidades, marca running, programa la primera unidad.
- **processPipelineUnit**: action. Ejecuta la lógica de una unidad (según jobType) y reporta resultado.
- **reportPipelineUnitComplete**: mutation. Actualiza progreso, programa siguiente unidad o finaliza.
- **finalizePipelineJob**: lógica por jobType (dentro de la mutation o en helpers): agrega resultados, escribe watermark, llama a `updatePipelineJobResult` o `updatePipelineJobError`.

### 3.2 Modelo de datos

**Tabla `pipelineJobs`** (existente, sin cambios de contrato para la UI):

- Se mantienen: `jobType`, `scope`, `status`, `progress`, `result`, `errorMessage`, `startedAt`, `completedAt`, etc.
- Opcional: si se quiere guardar estado de cola en el mismo documento, se puede añadir `scopeUnits?: array`, `completedUnits?: array` solo para uso interno del motor (la UI no los muestra). Alternativa: tabla separada.

**Nueva tabla `pipelineJobUnits`** (recomendada para cola reutilizable):

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `jobId` | `Id<"pipelineJobs">` | Job al que pertenece |
| `unitId` | string | Identificador único de la unidad (ej. `"2024-05-dias-1-3"`, `"2024-01"`) |
| `payload` | any | Datos para ejecutar (ej. `{ ym, startDay, endDay }`, `{ ym }`) |
| `status` | "pending" \| "running" \| "completed" \| "failed" | Estado de la unidad |
| `result` | any? | Resultado (inserted, updated, error, etc.) |
| `sortOrder` | number | Orden de procesamiento (0, 1, 2, …) |

Índices:

- `by_jobId` en `jobId` para cargar todas las unidades de un job.
- Opcional: `by_jobId_status` para consultar pendientes.

**Alternativa sin tabla nueva**: guardar en `pipelineJobs` un campo opcional `unitQueue?: { pending: Array<{ id, payload }>, completed: Array<{ id, result }> }`. Menos normalizado pero evita otra tabla; el documento puede crecer si hay muchas unidades.

### 3.3 Registro de tipos de job (driver table o switch)

El motor debe saber, por cada `jobType`:

1. **Generar unidades**: de `scope` → lista de `{ unitId, payload, sortOrder }`.
2. **Ejecutar unidad**: dado `payload`, qué action llamar y con qué argumentos.
3. **Finalizar**: dado el array de resultados de unidades, cómo construir `result` y si llamar a watermark u otras mutations.

Opciones de implementación:

- **Archivo único** `convex/pipelineRunner.ts`: objetos o mapas por `jobType` con funciones `generateUnits(scope)`, `executeUnit(ctx, payload)` (o nombre de action + args), `finalize(ctx, jobId, completedResults)`.
- **Un archivo por tipo** (ej. `convex/pipelineJobs/datamappingFullHistory.ts`) que exporta `generateUnits`, `executeUnit`, `finalize`, y un registro central que los asocia a `datamapping_full_history`.

En el documento se asume un **registro central por jobType** (switch o mapa) para no dispersar la lógica.

---

## 4. Especificación por jobType

Para cada jobType migrado, definir:

### 4.1 `datamapping_full_history`

- **Scope**: `{ months: string[] }` (ej. 2024-01 … 2026-02). Ya está en el POST actual.
- **Generar unidades**: por cada mes, rangos de N días (ej. 3). Cada unidad: `unitId = "${ym}-dias-${start}-${end}"`, `payload = { ym, startDay, endDay }`, `sortOrder` por mes y rango.
- **Ejecutar unidad**: action que para `payload.ym`, `payload.startDay`, `payload.endDay` hace el bucle de días y, por cada día, bucle de `fetchDatamappingForDayChunk` hasta `hasMore === false`. Retorna `{ inserted, updated, maxUpdatedAt }` o lanza.
- **Finalizar**: agrupar resultados por mes; calcular `completedMonths`, `failedMonths`, `byMonth`, `totalInserted`, `totalUpdated`; si hay `maxUpdatedAt` global, llamar a `setDatamappingWatermark`; `updatePipelineJobResult` con ese result; si hay failed, `updatePipelineJobError` con resumen.

### 4.2 `datamapping_clear`

- **Scope**: `{}` o `{ confirm: true }`.
- **Generar unidades**: una sola unidad: `unitId = "clear-all"`, `payload = {}`.
- **Ejecutar unidad**: action que en bucle llama a `deleteDatamappingRecordsBatch` hasta que retorne 0, y opcionalmente actualiza progreso cada N lotes (vía mutation). Retorna `{ totalDeleted }`.
- **Finalizar**: llamar a `clearDatamappingWatermark`; `updatePipelineJobResult` con `{ totalDeleted }`.

### 4.3 `datamapping_enrichment_by_months`

- **Scope**: `{ months: string[] }` (o fijo 2024-01 … 2026-02 como hoy).
- **Generar unidades**: un elemento por mes. `unitId = ym`, `payload = { ym }`.
- **Ejecutar unidad**: action que para ese mes hace el enriquecimiento (misma lógica que el step actual de Inngest: rango fromDate/toDate, bucle con continueState hasta isDone). Retorna `{ processed, enriched }` o error.
- **Finalizar**: agrupar por mes; `completedMonths`, `failedMonths`, `byMonth`; `updatePipelineJobResult`.

### 4.4 `datamapping_backfill_enrichment_by_months`

- Igual que enrichment por meses pero con la action de backfill correspondiente. Definir `payload` y resultado por unidad igual que en el archivo Inngest actual.

### 4.5 `datamapping_load_from_date`

- **Scope**: `{ sinceDate: string }`.
- **Generar unidades**: una unidad: `unitId = "load-from-date"`, `payload = { sinceDate }`.
- **Ejecutar unidad**: action que hace la carga desde esa fecha (misma lógica que el step actual).
- **Finalizar**: `updatePipelineJobResult` con el resultado devuelto por la unidad.

### 4.6 `datamapping_fecha_transaccion_full`

- **Scope**: `{ months: string[] }` o similar.
- **Generar unidades**: un elemento por mes.
- **Ejecutar unidad**: action que actualiza fechaTransaccion para ese mes (como en el Inngest actual).
- **Finalizar**: agregar por mes, `completedMonths`, `failedMonths`, `updatePipelineJobResult`.

### 4.7 `datamapping_fecha_transaccion_from_date`

- Una sola unidad; scope con fromDate; ejecutor y finalizer según lógica actual de Inngest.

### 4.8 `datamapping_incremental`

- Una sola unidad; scope vacío o con opciones; ejecutor = `fetchDatamappingIncremental`; finalizer escribe result y opcionalmente watermark si ya está en la action.

### 4.9 Cancelación

- Hoy: `pipelineJobCancelledHandler` de Inngest actualiza el job a `cancelled` cuando Inngest cancela. En Convex no hay “cancel” externo; se puede añadir una mutation `cancelPipelineJob(jobId)` que ponga `status: "cancelled"` y que `processPipelineUnit` / `reportPipelineUnitComplete` comprueben antes de seguir (si status ya es cancelled, no programar más unidades ni finalizar).

---

## 5. Pasos de migración (orden sugerido)

### Fase 1: Infraestructura del motor en Convex

1. **Schema**
   - Añadir tabla `pipelineJobUnits` en `convex/schema.ts` con campos `jobId`, `unitId`, `payload`, `status`, `result`, `sortOrder` e índice `by_jobId` (y opcional `by_jobId_status`).

2. **Motor genérico**
   - Crear `convex/pipelineRunner.ts` (o `convex/pipeline/runner.ts`):
     - `startPipelineJob(ctx, jobId)`: lee el documento del job, según `jobType` genera unidades (llamando a generadores por tipo), escribe filas en `pipelineJobUnits` (status pending), actualiza job a running, programa `runAfter(0, api.actions.processPipelineUnit, { jobId, unitId })` para la primera unidad (orden por sortOrder).
     - `reportPipelineUnitComplete(ctx, jobId, unitId, result)`: marca la unidad como completed (y guarda result), actualiza progress del job (current++), si hay más pendientes programa la siguiente; si no, llama a la lógica de finalize del jobType y luego `updatePipelineJobResult` o `updatePipelineJobError`.
     - `processPipelineUnit` (action): recibe jobId y unitId; carga la unidad, según jobType ejecuta la action correspondiente con el payload; llama a `reportPipelineUnitComplete` (vía mutation) con el resultado o con error (marcar unidad como failed y seguir o reintentar según política).

3. **Registro por jobType**
   - En el mismo archivo o en módulos separados, implementar para cada tipo:
     - `generateUnits(scope): { unitId, payload, sortOrder }[]`
     - ejecutor: qué action y argumentos (puede ser una action genérica que recibe jobType + payload y hace switch interno, o una action por tipo).
     - `finalize(ctx, jobId, completedResults)`: construir result y llamar a updatePipelineJobResult/Error y mutations auxiliares (watermark, etc.).

4. **Mutations exportadas**
   - Exponer `startPipelineJob(jobId)` para que la API la invoque después de `createPipelineJob`. El job ya debe existir con `jobType` y `scope` correctos.

### Fase 2: Migrar un solo job (full-history)

5. **Implementar generador, ejecutor y finalizer** para `datamapping_full_history` en el motor (rangos de días, action que hace bucle fetchDatamappingForDayChunk por rango, agregación por mes y watermark).

6. **Cambiar API** `POST /api/datamapping/full-history`:
   - Después de `createPipelineJob`, en lugar de `inngest.send(...)`, llamar a la mutation Convex `startPipelineJob` con el nuevo jobId.

7. **Quitar Inngest** para full-history: eliminar la función `datamappingFullHistory` del serve en `src/app/api/inngest/route.ts` y opcionalmente borrar o archivar `src/inngest/datamapping-full-history.ts`.

8. **Probar** full-history de punta a punta (crear job, ver progreso en UI, resultado y watermark).

### Fase 3: Migrar el resto de jobs

9. **datamapping_clear**: implementar unidades (1), ejecutor (borrar lotes), finalizer (watermark + result). Cambiar POST `/api/datamapping/clear` a `startPipelineJob`. Quitar función Inngest y referencia en route.

10. **datamapping_enrichment_by_months**: unidades por mes, ejecutor por mes, finalizer por mes. Cambiar POST de enrich-by-months. Quitar Inngest.

11. **datamapping_backfill_enrichment_by_months**: igual patrón. Cambiar API y quitar Inngest.

12. **datamapping_load_from_date**: una unidad. Cambiar API y quitar Inngest.

13. **datamapping_fecha_transaccion_full** y **from_date**: igual que arriba. Cambiar APIs y quitar Inngest.

14. **datamapping_incremental**: una unidad; si se dispara por cron, el cron puede llamar a una API que cree job y startPipelineJob, o una Convex cron que cree el job y arranque el motor.

15. **Cancelación**: implementar `cancelPipelineJob(jobId)` y que el motor no programe más unidades si el job está cancelled. La UI puede mostrar un botón “Cancelar” que llame a esa mutation.

### Fase 4: Limpieza y documentación

16. **Inngest**: si ya no queda ninguna función de pipeline, se puede eliminar la ruta `/api/inngest` o dejarla solo con `testPing` para pruebas. Eliminar imports y archivos de funciones migradas en `src/inngest/`.

17. **Docs**: actualizar `docs/jobs-page.md`, `docs/mass-loads-inngest-pattern.md` (o renombrar a “mass-loads-pipeline-pattern.md”) para describir el motor en Convex; actualizar `docs/inngest-setup.md` indicando que los pipelines ya no usan Inngest. Añadir referencia a este documento en el README.

18. **Variables de entorno**: si se deja de usar Inngest para pipelines, no hace falta INNGEST_EVENT_KEY / signing para estos flujos; mantener solo si se usa para otras cosas (ej. testPing o futuros eventos).

---

## 6. Checklist para la sesión de refactor

Usar esta lista en orden durante la sesión:

- [ ] **Schema**: tabla `pipelineJobUnits` añadida y desplegada.
- [ ] **Motor**: `startPipelineJob`, `reportPipelineUnitComplete`, `processPipelineUnit` (action) implementados con registro por jobType.
- [ ] **Full-history**: generador (rangos 3 días), ejecutor (bucle por día/chunk), finalizer (agregar por mes, watermark); API cambiada a Convex; Inngest full-history quitado; prueba E2E.
- [ ] **Clear**: una unidad, ejecutor (borrar lotes), finalizer (watermark + result); API + quitar Inngest; prueba.
- [ ] **Enrichment by months**: unidades por mes, ejecutor, finalizer; API + quitar Inngest; prueba.
- [ ] **Backfill enrichment by months**: idem; API + quitar Inngest; prueba.
- [ ] **Load from date**: una unidad; API + quitar Inngest; prueba.
- [ ] **Fecha transacción full y from_date**: unidades y ejecutores; APIs + quitar Inngest; prueba.
- [ ] **Incremental**: una unidad; trigger (API o cron) + prueba.
- [ ] **Cancelación**: mutation `cancelPipelineJob` y comprobación en motor; botón en UI (opcional).
- [ ] **Limpieza**: eliminar o archivar archivos Inngest de pipeline; actualizar `route.ts`; docs actualizados.

---

## 7. Referencias rápidas de archivos

| Qué | Dónde |
|-----|--------|
| Schema pipelineJobs | `convex/schema.ts` (líneas ~389-418) |
| Mutations pipelineJobs | `convex/pipelineJobs.ts` |
| Actions datamapping (fetch chunk, clear, etc.) | `convex/actions.ts` |
| Rutas API datamapping | `src/app/api/datamapping/*/route.ts` |
| Serve Inngest | `src/app/api/inngest/route.ts` |
| Funciones Inngest | `src/inngest/datamapping-*.ts`, `pipeline-job-cancelled-handler.ts` |
| UI Jobs / Carga de fuentes | `src/app/configuracion/carga-fuentes/page.tsx`, `configuracion/status/page.tsx` |
| Patrón cargas masivas (actual) | `docs/mass-loads-inngest-pattern.md` |
| Configuración y pipelineJobs | `docs/jobs-page.md` |

---

## 8. Notas de implementación

- **Reintentos**: si una unidad falla, se puede marcar como failed y continuar con las demás (como hoy con allSettled), o reintentar la misma unidad N veces antes de marcarla failed. La política puede ser configurable por jobType.
- **Paralelismo**: el diseño anterior procesa unidades en **serie** (una tras otra) para simplificar. Si se quiere paralelismo, al iniciar se pueden programar varias unidades con `runAfter(0, processPipelineUnit, …)` para distintas unitIds; en `reportPipelineUnitComplete` hay que detectar “última unidad en completar” para ejecutar finalize una sola vez (p. ej. contador atómico de completadas vs total).
- **Límite 10 min**: si una unidad supera 10 min (límite de Convex action), hay que subdividir más (ej. 1 día por unidad para full-history en meses muy densos). El generador puede recibir un parámetro (ej. daysPerUnit) por jobType.
- **Observabilidad**: al no usar Inngest, los “runs” se ven en la UI de Jobs (Convex) y en el Dashboard de Convex (logs de actions). Opcional: enviar evento a Inngest o webhook al completar un job para integraciones externas.
