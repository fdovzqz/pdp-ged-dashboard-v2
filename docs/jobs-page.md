# Configuración y modelo pipelineJobs

Toda la configuración de datos, cargas, jobs, enriquecimiento y agregaciones está bajo **Configuración** (`/configuracion`), con cuatro subpáginas. El estado de los jobs se persiste en Convex.

Las **cargas masivas** (histórico datamapping, y en el futuro enriquecimientos, agregaciones, reconciliaciones) siguen el [patrón documentado en mass-loads-inngest-pattern.md](mass-loads-inngest-pattern.md): un step por unidad (p. ej. mes), ejecución en paralelo, reintentos por step, resultado con `completedMonths` / `failedMonths` para saber qué terminó bien y en qué enfocarse.

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
│   - IngestionStatus (registros por mes/día)                      │
│   - Borrar mes / Borrar todo                                     │
│   - Códigos de movimiento (CRUD)                                 │
│   - Aliases de movimiento (CRUD)                                  │
├─────────────────────────────────────────────────────────────────┤
│ Carga de fuentes (/configuracion/carga-fuentes)                  │
│   - Sync CloudWatch   → fetchAndIngestForDate                    │
│   - Carga DynamoDB    → full history, re-extraer, incremental,   │
│                         load from date, backfill fechaTransaccion,│
│                         clear (Inngest)                          │
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

### 2. Sincronizar CloudWatch

Rango de fechas (startDate, endDate) + botón para iniciar sincronización.

- **Componente**: `SyncDialog` (modal con formulario).
- **Action**: `fetchAndIngestForDate` por cada día del rango.
- **Progreso**: fecha actual, índice/total, posibilidad de cancelar.
- **Resultado**: insertados, borrados, días fallidos.
- **Persistencia**: estado en `localStorage` durante la ejecución para poder reanudar tras refresco.

### 3. Agregados CloudWatch

Selector de meses (multi-select) + botón "Generar tablas agregadas".

- **Action**: `buildJanuaryAggregates` para cada mes seleccionado.
- **Progreso**: barra de progreso durante la ejecución.
- **Resultado/error**: resumen por mes o mensaje de error.

Tablas generadas: `rawHourlyData`, `dailyData`, `monthStats`, etc., según [datamapping-aggregations.md](../datamapping-aggregations.md) y la lógica de CloudWatch.

### 4. Datamapping (DynamoDB)

Centraliza extracción desde datamapping (todos los status, no solo PAGO VALIDADO). ~900k registros total. **Sin duplicados**: upsert por `transactionId`; `updatedAt` es la marca de agua para incremental.

#### 4a. Histórico completo (desde 2024-01-01)

- **Botón "Extraer toda la historia"**: dispara un **Inngest** job que procesa cada mes desde 2024-01 hasta hoy **en paralelo**, y dentro de cada mes cada día por **chunks** (`fetchDatamappingForDayChunk` por página DynamoDB) para evitar timeout 524/600s.
- **Independiente de la UI**: el job corre en Inngest; puedes refrescar o navegar a otras áreas y regresar para ver el avance.
- **Progreso persistido** en `pipelineJobs` (Convex): la UI consulta `getLatestDatamappingFullHistoryJob` para mostrar estado, barra de progreso y mensaje.
- Portal Durango entró en operación ene 2024.
- Al completar, actualiza la marca de agua para extracción incremental.
- **Flujo**: POST `/api/datamapping/full-history` → crea `pipelineJob` → envía evento Inngest `reconciliation/datamapping.full-history` → función Inngest procesa meses en paralelo (cada día por chunks) → actualiza watermark y resultado.
- **Resultado del job**: `completedMonths` (lista de meses ok), `failedMonths` (lista `{ ym, error }` de los que fallaron tras reintentos), `byMonth` (por mes: `status: "completed"` con inserted/updated o `status: "failed"` con error), `summary`. Ver [mass-loads-inngest-pattern.md](mass-loads-inngest-pattern.md).

#### 4b. Re-extraer período

- **Selector de meses**: multi-select de meses a re-extraer.
- **Botón "Re-extraer meses seleccionados"**: ejecuta `fetchDatamappingForMonth` para cada mes seleccionado, en paralelo.
- **Upsert**: actualiza registros modificados (si un registro cambió en DynamoDB, se sobrescribe por `transactionId`).

#### 4c. Incremental (últimos cambios)

- **Botón "Extraer cambios recientes"**: ejecuta `fetchDatamappingIncremental` desde la última marca de agua (`updatedAt`).
- Para ejecución periódica (cada hora o 5 min).
- Si no hay marca de agua: retorna mensaje indicando ejecutar histórico primero.
- **Marca de agua**: se guarda en `processingControl` con key `datamapping_watermark`.

#### 4d. Carga manual (legacy)

- Campo `sinceDate` + "Cargar desde fecha": `fetchDatamappingAndIngest` por páginas.
- Útil para pruebas o carga puntual desde una fecha.

#### 4e. Borrar datamapping

- Diálogo de confirmación → `deleteDatamappingBatch` para limpiar registros.

**API**:
- `fetchDatamappingForDayChunk(year, month, day, exclusiveStartKey?)`: extrae un chunk (1 página DynamoDB) de un día, retorna `{ inserted, updated, hasMore, exclusiveStartKey, maxUpdatedAt }`. Usado por Inngest para histórico completo (evita 524/600s).
- `fetchDatamappingForMonth(year, month)`: extrae un mes completo, retorna `{ inserted, updated, maxUpdatedAt }`.
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

## Página Datos: contenido actual

Tras el refactor, la página Datos (`/upload`) contiene solo:

1. **Registros cargados (IngestionStatus)**  
   Grilla de meses/días con conteos y estado de ingestión (CloudWatch, datamapping).

2. **Borrar mes**  
   Elimina `paymentRecords` y `monthStats` de un mes seleccionado.

3. **Borrar todo**  
   Elimina todos los meses del período configurado.

4. **Códigos de movimiento**  
   CRUD para códigos y descripciones de movimiento (seed, upsert, delete).

5. **Aliases de movimiento**  
   CRUD para aliases (variante → código).

6. **Enlace a Jobs**  
   "Ejecutar cargas, enriquecimiento y agregaciones en **Jobs**" → `/jobs`.

---

## Navegación

En `src/components/Nav.tsx`:

- **Jobs**: `href: "/jobs"`, icono `ListTodo`, entre Datos y Reconciliar.

---

## Paralelismo y Inngest

- **Patrón de cargas masivas**: un step por unidad (mes, día, etc.), lanzados en paralelo con `Promise.all`; `Promise.allSettled` para capturar éxitos y fallos; resultado con `completedUnits` y `failedUnits`. Aplica a histórico datamapping, y se extiende a enriquecimientos, agregaciones y reconciliaciones. Ver [mass-loads-inngest-pattern.md](mass-loads-inngest-pattern.md).
- **Inngest Dev Server (Runs)**: cada step se ve como barra; los que corren en paralelo se solapan. Si un step falló y fue reintentado, al expandirlo se ven Attempt 0 (fallo), Attempt 1, Attempt 2 (éxito si el reintento lo solucionó).
- **Cron**: agendamiento periódico vía Inngest para extracciones automáticas (fase posterior).

Ver [architecture-pipelines-reconciliation.md](../architecture-pipelines-reconciliation.md) y [inngest-setup.md](inngest-setup.md).
