# Configuración y modelo pipelineJobs

Toda la configuración de datos, cargas, jobs, enriquecimiento y agregaciones está bajo **Configuración** (`/configuracion`), con cuatro subpáginas. El estado de los jobs se persiste en Convex.

Las **cargas masivas** (histórico datamapping, enriquecimientos, backfill, fechaTransaccion) usan el **motor de pipeline en Convex** (ver [refactor-pipeline-convex.md](refactor-pipeline-convex.md) y [mass-loads-pipeline-pattern.md](mass-loads-pipeline-pattern.md)): unidades de trabajo en cola, ejecución en serie en Convex (límite 10 min por unidad), resultado con `completedMonths` / `failedMonths` en `pipelineJobs`.

**Redirects**: `/upload` → `/configuracion/datos`, `/jobs` → `/configuracion/status`.

---

## Objetivo

- **Configuración**: una entrada en el nav con subpáginas para Gestión de datos, Carga de fuentes, Enriquecimiento y agregaciones, Status de actualizaciones.
- **Estado persistido**: los jobs sobreviven al refrescar la página (Convex).

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│ Configuración (/configuracion)                                   │
├─────────────────────────────────────────────────────────────────┤
│ Gestión de datos (/configuracion/datos)                         │
│   - Códigos de movimiento (CRUD)                                 │
│   - Aliases de movimiento (CRUD)                                  │
├─────────────────────────────────────────────────────────────────┤
│ Carga de fuentes (/configuracion/carga-fuentes)                  │
│   - Registros cargados: paymentRecords vs datamappingRecords     │
│     (DataMapping PV−DEC, diferencia CW−(PV−DEC); total/año/mes/día) │
│   - Sync CloudWatch   → fetchAndIngestForDate o por meses (paralelo) │
│   - Borrar mes / Borrar todo (paymentRecords) en card CloudWatch │
│   - Carga DynamoDB    → full history, re-extraer, incremental,   │
│                         load from date, backfill fechaTransaccion,│
│                         clear (motor Convex)                     │
├─────────────────────────────────────────────────────────────────┤
│ Enriquecimiento y agregaciones (/configuracion/enriquecimiento-agregaciones) │
│   - Enriquecimiento (texto: en la carga)                         │
│   - Agregados DM      → buildDatamappingAggregates               │
│   - Agregados CW      → buildJanuaryAggregates                    │
├─────────────────────────────────────────────────────────────────┤
│ Status de actualizaciones (/configuracion/status)                │
│   - Marca de agua datamapping                                     │
│   - Pipeline Jobs     → listPipelineJobs, getPipelineJob          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Subpáginas: detalle

### Status de actualizaciones: Pipeline Jobs

Tabla paginada de jobs registrados en la tabla `pipelineJobs`. Muestra:

- Tipo de job (`jobType`)
- Alcance (`scope`: fechas, meses, etc.)
- Estado (pendiente, en curso, completado, error, cancelado)
- Progreso (barra cuando hay `progress.current` / `progress.total`)
- Resultado o mensaje de error
- Fechas de inicio y fin

**Interacción**: Clic en un job abre un modal con el detalle completo (scope, result, errorMessage, retryCount, etc.).

**API**:
- `listPipelineJobs`: paginado por `startedAt` descendente, filtros opcionales por `status` y `jobType`.
- `getPipelineJob`: detalle de un job por id.

### 2. Carga de fuentes: Registros cargados y CloudWatch

**Registros cargados** (card superior): Comparación entre tablas Convex `paymentRecords` (origen CloudWatch) y `datamappingRecords` (origen DynamoDB). Para cada nivel (total, año, mes) se muestran: **paymentRecords**, **datamappingRecords** (total, PAGO VALIDADO, PAGO VALIDADO - DEC), **DataMapping (PV − DEC)** — valor comparable con paymentRecords, es decir (PAGO VALIDADO − PAGO VALIDADO DEC) — y **Diferencia** = paymentRecords − DataMapping (PV − DEC). Así se ve de un vistazo el número de DataMapping que se compara con CloudWatch y la diferencia. Botones "Recalcular paymentRecords" y "Recalcular datamappingRecords" para forzar recálculo de estadísticas. **Criterio de “mes”:** paymentRecords = fecha del evento (importMonth/importDate); datamappingRecords = updatedAt. Las diferencias por mes pueden ser grandes; no es error de extracción. Ver nota en la propia card.

**Sincronizar CloudWatch:** (1) Carga completa. (2) **Carga por rango** (recomendada): fecha inicio/fin → 1 unidad por día, hasta 6 en paralelo (`cloudwatch_sync_by_range`). (3) Carga desde fecha. (4) Incremental. Avance en Status de actualizaciones; **Borrar mes** y **Borrar todo (paymentRecords)** en la misma card.

### 3. Agregados CloudWatch

Selector de meses (multi-select) + botón "Generar tablas agregadas".

- **Action**: `buildJanuaryAggregates` para cada mes seleccionado.
- **Progreso**: barra de progreso durante la ejecución.
- **Resultado/error**: resumen por mes o mensaje de error.

Tablas generadas: `rawHourlyData`, `dailyData`, `monthStats`, etc., según [datamapping-aggregations.md](../datamapping-aggregations.md) y la lógica de CloudWatch.

### 4. Datamapping (DynamoDB)

Centraliza extracción desde datamapping (todos los status, no solo PAGO VALIDADO). ~900k registros total. **Sin duplicados**: upsert por `transactionId`; `updatedAt` es la marca de agua para incremental.

#### 4a. Histórico completo (desde 2024-01-01)

- **Botón "Ejecutar job"**: crea un pipeline job en Convex que procesa desde 2024-01-01 por **rangos de 3 días por mes**, en paralelo (hasta 6 unidades a la vez). Cada unidad usa `fetchDatamappingForDayChunk` en bucle para evitar timeout 524/600s.
- **Progreso** en `pipelineJobs`: la UI consulta `getLatestDatamappingFullHistoryJob` para estado y barra de progreso.
- Al completar se actualiza la marca de agua y se programa `getDatamappingIngestionStats`.
- **Resultado**: `completedMonths`, `failedMonths`, `byMonth`, `summary`. Ver [mass-loads-pipeline-pattern.md](mass-loads-pipeline-pattern.md).

#### 4b. Carga por rango (recomendada)

- **Fecha inicio y fecha fin**: inputs tipo fecha; al ejecutar se crea un job con **una unidad por día** en ese rango, hasta **6 días en paralelo** (`datamapping_sync_by_range`). Cada día se procesa por **chunks** (bucle `fetchDatamappingForDayChunk`) para evitar timeouts ~5 min en días con mucho volumen. Progreso en "X de Y días"; resultado con `byDate`, `completedDays`, `failedDays`. Si falla un día, el error real se muestra en la UI (Error y Detalle por día) y en Audit.
- **Alternativa por meses**: la API acepta también `start`/`end` en YYYY-MM y crea `datamapping_sync_by_months` (una unidad por mes). Cada mes se procesa **día a día con el mismo proceso por chunks**, por lo que meses pesados (p. ej. mayo 2024) no superan el límite de tiempo.

#### 4c. Incremental (últimos cambios)

- **Botón "Extraer cambios recientes"**: ejecuta `fetchDatamappingIncremental` desde la última marca de agua (`updatedAt`).
- Para ejecución periódica (cada hora o 5 min).
- Si no hay marca de agua: retorna mensaje indicando ejecutar histórico primero.
- **Marca de agua**: se guarda en `processingControl` con key `datamapping_watermark`.

#### 4d. Carga manual (legacy)

- Campo `sinceDate` + "Cargar desde fecha": `fetchDatamappingAndIngest` por páginas (bucle desde la API/UI).
- Útil para pruebas o carga puntual desde una fecha.
- El resultado del job incluye **byDate** (registros procesados por día según `updatedAt`); la página de detalle del run muestra la sección **"Registros por día"** con la misma información que los otros procesos de carga.

#### 4e. Borrar datamapping

- Diálogo de confirmación → `deleteDatamappingBatch` para limpiar registros.

#### 4f. Backfill fechaTransaccion

- **Ejecución completa**: botón que crea un job `datamapping_fecha_transaccion_full` con unidades de **3 días por mes** (desde 2024-07 hasta el mes actual). Progreso y resultado en Status de actualizaciones; si alguna unidad falla (p. ej. por OCC), queda en "Unidades fallidas" con su identificador (p. ej. `fecha-transaccion-full-2024-07-01-2024-07-03`).
- **Rango personalizado (reintentar bloques fallidos)**: en la misma sección, inputs **Desde** y **Hasta** (fechas YYYY-MM-DD) y botón **"Ejecutar solo este rango"**. Se crea un job con el mismo tipo pero generando solo unidades de 3 días dentro de ese rango. Sirve para reintentar los periodos fallidos sin volver a ejecutar todo el backfill (p. ej. 2024-07-01 a 2024-07-03, o 2025-08-16 a 2025-08-21 para cubrir dos bloques de agosto). La API `POST /api/datamapping/fecha-transaccion-full` acepta body opcional `{ startDate, endDate }`; si se envían, el job usa `scope: { mode: "full", startDate, endDate }`.

**API**:
- `fetchDatamappingForDayChunk(year, month, day, exclusiveStartKey?)`: extrae un chunk (1 página DynamoDB) de un día, retorna `{ inserted, updated, hasMore, exclusiveStartKey, maxUpdatedAt }`. Usado en bucle por **sync por rango**, **sync por meses** e **histórico completo** para evitar timeouts (~5 min).
- `fetchDatamappingForMonth(year, month)`: extrae un mes completo en una action; solo para uso interno o legacy; los jobs de sync por meses usan día a día con fetchDatamappingForDayChunk.
- `fetchDatamappingAndIngest(sinceDate, exclusiveStartKey?)`: una página de registros desde sinceDate; retorna `{ inserted, updated, hasMore, lastEvaluatedKey, byDate }`. El handler de load_from_date hace bucle y acumula **byDate** para el desglose por día en la UI.
- `fetchDatamappingIncremental()`: extrae desde watermark, retorna `{ inserted, updated, processed, newWatermark, message? }`.
- `getDatamappingWatermark`, `setDatamappingWatermark`: consulta/actualiza marca de agua.

Ver [reconciliation-dynamodb.md](../reconciliation-dynamodb.md) para el proceso de extracción desde DynamoDB.

### 5. Agregados DataMapping

Selector de meses (multi-select) + botón "Generar tablas agregadas (DataMapping)".

- **Action**: `buildDatamappingAggregates` para los meses seleccionados.
- **Resultado/error**: resumen por mes o mensaje de error.

Tablas: `*Datamapping` (rawHourlyDataDatamapping, dailyDataDatamapping, etc.). Ver [datamapping-aggregations.md](../datamapping-aggregations.md).

### 6. Enriquecimiento RFC

- **Formulario**: `fromDate`, `toDate`.
- **Botón "Calcular pendientes"**: preflight para ver cuántos registros tienen `enrichmentExtracted: false`.
- **Botón "Enriquecer datamapping con RFC"**: crea un run en `rfcEnrichmentRuns` y ejecuta `enrichDatamappingWithRfc`.
- **Tabla de runs**: inicio, rango, estado, procesados, enriquecidos.
- **"Continuar"**: si un run quedó en `timed_out`, permite reanudar con el mismo `runId`.

Ver [rfc-enrichment-datamapping.md](../rfc-enrichment-datamapping.md).

### 7. Backfill enrichmentExtracted

- **Botón "Preparar enrichmentExtracted (1 vez)"**: ejecuta `backfillDatamappingEnrichmentExtracted`; marca `enrichmentExtracted: false` en todos los registros.
- **"Continuar backfill"**: si la acción hace timeout, reanudar con el cursor devuelto.

---

## Schema: pipelineJobs

Tabla en Convex para representar jobs de pipeline con estado persistido.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `jobType` | string | Tipo de job (p. ej. `"cloudwatch_sync"`, `"dynamodb_load"`) |
| `scope` | any | Alcance flexible (sinceDate, month, months, cursor, etc.) |
| `status` | enum | `pending` \| `running` \| `completed` \| `failed` \| `cancelled` |
| `progress` | object? | `{ current, total?, unit?, message? }` |
| `result` | any? | Resultado al completar |
| `errorMessage` | string? | Mensaje de error si falló |
| `startedAt` | number | Timestamp de inicio |
| `completedAt` | number? | Timestamp de fin |
| `dependsOnJobIds` | id[]? | Jobs de los que depende |
| `parentJobId` | id? | Job padre (sub-jobs) |
| `externalId` | string? | ID externo (Inngest, etc.) |
| `retryCount` | number? | Reintentos |

**Índices**:
- `by_startedAt` – listar recientes primero
- `by_status` – filtrar por estado
- `by_jobType` – filtrar por tipo

---

## API: pipelineJobs (convex/pipelineJobs.ts)

| Función | Tipo | Descripción |
|---------|------|-------------|
| `createPipelineJob` | mutation | Crea job con `status: "pending"` |
| `updatePipelineJobProgress` | mutation | Actualiza `status` y/o `progress` |
| `updatePipelineJobResult` | mutation | Marca `completed` con `result` |
| `updatePipelineJobError` | mutation | Marca `failed` con `errorMessage` |
| `updatePipelineJobRetry` | mutation | Actualiza `retryCount` |
| `listPipelineJobs` | query | Lista paginada, filtros por status/jobType |
| `getPipelineJob` | query | Obtiene un job por id |

---

## Página Carga de fuentes y Registros cargados

En **Carga de fuentes** (`/configuracion/carga-fuentes`):

1. **Registros cargados**  
   Una sola card con: **paymentRecords** (CloudWatch), **datamappingRecords** (total, PAGO VALIDADO, PAGO VALIDADO - DEC), **DataMapping (PV − DEC)** — (PAGO VALIDADO − PAGO VALIDADO DEC), el valor que se compara con paymentRecords — y **Diferencia** = paymentRecords − DataMapping (PV − DEC), por total, año, mes y día. Grilla de meses para seleccionar y ver detalle por día. Botones **Recalcular paymentRecords** y **Recalcular datamappingRecords** para forzar actualización de estadísticas. Las estadísticas se actualizan solas al cargar/borrar (monthStats por día en CW; datamappingIngestionStats en cada lote de upsert/delete). **Criterio de “mes”:** paymentRecords = fecha del evento (importMonth/importDate, hora México); datamappingRecords = updatedAt. Las diferencias por mes pueden ser grandes; no indica error de extracción ni duplicados.

2. **Sincronizar CloudWatch**  
   **Carga por rango** (recomendada): fecha inicio/fin → 1 unidad por día, hasta 6 en paralelo. Carga completa, carga desde fecha, incremental. **Borrar mes** / **Borrar todo (paymentRecords)**. Avance en Status de actualizaciones.

3. **Datamapping (DynamoDB)**  
   **Carga por rango** (recomendada): fecha inicio/fin → 1 unidad por día, hasta 6 en paralelo. Histórico completo, incremental, load from date, backfill fechaTransaccion, clear.

En **Gestión de datos** (`/configuracion/datos`): Códigos de movimiento, Aliases de movimiento, enlace a Status de actualizaciones.

---

## Navegación

En `src/components/Nav.tsx`:

- **Jobs**: `href: "/jobs"`, icono `ListTodo`, entre Datos y Reconciliar.

---

## Paralelismo y motor Convex

- **Cargas masivas**: motor de pipeline en Convex (cola `pipelineJobUnits`). **Carga por rango** en CloudWatch y DataMapping = 1 unidad por día, hasta 6 en paralelo. Otros jobTypes (por meses, full history, etc.) también usan pool de 6 workers. Ver [mass-loads-pipeline-pattern.md](mass-loads-pipeline-pattern.md) y [refactor-pipeline-convex.md](refactor-pipeline-convex.md).
- **Progreso**: Status de actualizaciones (`/configuracion/status`) muestra jobs y barra de progreso; los datos en Convex se actualizan según va terminando cada unidad.

## Nota: fechas en CloudWatch y re-extracción

Si en el parser no se podía extraer fecha del log, antes se usaba un fallback fijo (ej. enero 2026), concentrando registros sin fecha en ese mes. Eso se eliminó: en `fetchAndIngestForDate` los registros sin fecha parseable reciben el **día que se está sincronizando** (y su mes). Para corregir datos ya cargados con el fallback antiguo hay que **re-extraer** CloudWatch (período afectado o completo).

Ver también [architecture-pipelines-reconciliation.md](architecture-pipelines-reconciliation.md), [inngest-setup.md](inngest-setup.md) (si se usa Inngest para otros flujos).
