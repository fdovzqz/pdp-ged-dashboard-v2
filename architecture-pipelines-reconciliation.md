# Arquitectura: Pipelines de datos y reconciliación

Documento de arquitectura para las fuentes de datos, su ingesta en Convex (versiones normalizadas para análisis rápido), reconciliación entre fuentes, y el ciclo **problemas → corrección → re-ejecución**, con orquestación vía **Inngest**.

---

## 1. Fuentes de datos

| Fuente | Descripción | Estado | Tabla(s) Convex (espejo) |
|--------|-------------|--------|---------------------------|
| **CloudWatch** | Logs Step Functions: V1, V2, Payment (EVO). Pagos reportados por los procesos. | Actual | `paymentRecords`, agregados `*` (rawHourlyData, dailyData, …) |
| **DynamoDB** | Datamapping PAGO VALIDADO (backup prod). Fuente de verdad para “lo que se cobró”. | Actual | `datamappingRecords`, agregados `*Datamapping` |
| **EVO CSV** | Archivos CSV que entregan pagos EVO. Formato y frecuencia por definir. | Futuro | `evoCsvRecords` (por definir) |
| **SEI** | Sistema que registra pagos e indica cuándo algo fue pagado por V1/V2. Retroalimentación. | Futuro | `seiFeedbackRecords` (por definir) |

Objetivo: tener en Convex **versiones normalizadas** de cada fuente para análisis y reconciliación rápidos, sin depender de consultas directas a CloudWatch/DynamoDB/archivos en tiempo de uso.

---

## 2. Visión general del flujo

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ FUENTES EXTERNAS                                                                  │
│  CloudWatch (V1, V2, Payment)   DynamoDB (datamapping)   EVO CSV   SEI (futuro)  │
└────────────┬────────────────────────────┬────────────────────────┬──────────────┘
             │                            │                        │
             ▼                            ▼                        ▼
┌────────────────────────────┐ ┌────────────────────────┐ ┌──────────────────────┐
│ Pipeline CloudWatch         │ │ Pipeline DynamoDB       │ │ Pipeline EVO CSV     │
│ (Inngest: por día/fuente)  │ │ (Inngest: por día/pág)  │ │ (Inngest: por archivo)│
└────────────┬───────────────┘ └────────────┬───────────┘ └──────────┬───────────┘
             │                              │                         │
             ▼                              ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ CONVEX – Espejos normalizados + agregados                                         │
│  paymentRecords │ datamappingRecords │ evoCsvRecords │ seiFeedbackRecords         │
│  monthStats, rawHourlyData, dailyData, … │ *Datamapping │ (agregados por fuente)  │
└────────────┬─────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌────────────────────────────┐     ┌──────────────────────────────────────────────┐
│ Reconciliación              │     │ Problemas / Errores                           │
│ (comparar fuentes por ref)   │────▶│ reconciliationErrors + pipelineProblems      │
└────────────┬────────────────┘     │ (kind, referencia, source, processStep…)    │
             │                       └────────────┬─────────────────────────────────┘
             │                                    │
             │                                    ▼
             │                       ┌──────────────────────────────────────────────┐
             │                       │ Corrección (humano / proceso)                 │
             │                       │ → Re-ejecutar pipeline (ingesta / paso)       │
             │                       │   vía Inngest                                 │
             └───────────────────────┴──────────────────────────────────────────────┘
```

---

## 3. Escala (~900k), límites Convex y modelo de jobs

La tabla `datamappingRecords` y operaciones similares pueden superar **~900k registros**. Cualquier job debe diseñarse para ejecutarse **en modo asíncrono**, con **progreso y resultado persistidos en Convex** (independientes de la UI: refresh no pierde estado) y con **dependencias** para no ejecutar un paso antes de que sus requisitos estén listos.

### 3.1 Límites Convex relevantes

| Límite | Valor | Impacto en pipelines |
|--------|--------|------------------------|
| **Action execution time** | 10 min (600 s) | Por seguridad usamos ~550 s; un solo “run” no puede procesar ~900k en una acción. |
| **Query/mutation execution** | 1 s (user code) | Queries/mutations deben ser acotadas; loops pesados en actions. |
| **Transaction (por query/mutation)** | 32k docs escaneados, 16k escritos, 16 MiB read/write | Batches de mutación ≤ ~400–500; lecturas paginadas (cursor). |
| **Function return size** | 16 MiB (args Node 5 MiB) | No devolver ~900k registros en una respuesta; devolver cursores y resúmenes. |
| **Concurrent Node actions** | 64 (Starter) / 1000 (Pro) | Permite paralelismo (varios días o páginas a la vez). |

Para **~900k en datamapping**:

- **Ingesta:** no una sola acción que haga loop hasta el final; sí **muchas acciones pequeñas** (por chunk con `fetchDatamappingForDayChunk` (1 página DynamoDB), por día con `fetchDatamappingForDay`, o por página con `fetchDatamappingAndIngest` con `exclusiveStartKey`). Cada una procesa un subconjunto acotado (p. ej. ~1k ítems por chunk) y devuelve cursor o “siguiente día”.
- **Enriquecimiento RFC:** ya hay `continueState`; cada “step” debe actualizar un **job** en Convex (procesados, estado) y, si llega al timeout, programar el siguiente step (Inngest o siguiente llamada) con `continueState`.
- **Agregación (*Datamapping):** `buildDatamappingAggregates` por **un mes** puede leer ~30k–100k+ registros en páginas de 1000; con ~900k total (varios meses) se trabaja por mes. Estrategia: **un job de agregación por mes** (o por chunk de tiempo si un mes es demasiado grande), cada uno en una acción separada.

### 3.2 Modelo de jobs: estado persistido (async, progreso, resultado, UI-independent)

Todo trabajo de pipeline debe estar representado por un **job** en Convex cuya evolución pueda consultarse en cualquier momento (incluido tras refresh).

**Tabla propuesta: `pipelineJobs`**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `jobType` | string | Ej. `datamapping/ingest`, `datamapping/enrich-rfc`, `datamapping/aggregate`, `cloudwatch/ingest`, `reconciliation/run`. |
| `scope` | object | Alcance del job: `{ sinceDate?, untilDate?, month?, months[]?, cursor? }` según el tipo. |
| `status` | `pending \| running \| completed \| failed \| cancelled` | Estado actual. |
| `progress` | object (opcional) | `{ current: number, total?: number, unit: "pages" \| "days" \| "records" \| "months", message?: string }` para mostrar avance. |
| `result` | object (opcional) | Al terminar: `{ inserted?, updated?, processed?, enriched?, errorCount?, summary? }` según el tipo. |
| `errorMessage` | string (opcional) | Si `status === "failed"`. |
| `startedAt` | number | Timestamp de creación o de inicio. |
| `completedAt` | number (opcional) | Timestamp de fin (completed/failed/cancelled). |
| `dependsOnJobIds` | array of Id (opcional) | Jobs que deben estar `completed` antes de que este pueda ejecutarse. |
| `parentJobId` | Id (opcional) | Si este job es un sub-job (p. ej. “día 15” de “ingest enero”), el padre. |
| `externalId` | string (opcional) | Id de Inngest run o similar para correlación. |

- **Creación:** la UI o Inngest crea el documento con `status: "pending"` (y opcionalmente `dependsOnJobIds`).
- **Progreso:** la acción Convex que ejecuta el trabajo hace `patch` del job: `status: "running"`, `progress: { current, total, unit, message }`, y al terminar `status`, `result`, `completedAt` (y `errorMessage` si falla).
- **Consulta:** la UI suscribe a `pipelineJobs` (por ejemplo por `jobType` + `startedAt` o por `parentJobId`) y muestra lista de jobs con estado, barra de progreso y resultado. **Refresh:** se vuelve a suscribir y se ve el mismo estado.
- **Sub-jobs:** para “ingest enero” se pueden crear 31 jobs hijos (uno por día) con `parentJobId` apuntando al job “ingest enero”. El padre puede marcarse `completed` cuando todos los hijos estén `completed` (o actualizar su `progress` como suma de los hijos).

### 3.3 Dependencias entre jobs

Ningún job debe ejecutar trabajo que dependa de datos que aún no existen. Reglas:

1. **Definición:** cada job puede declarar `dependsOnJobIds`. Inngest (o el orquestador) **no** debe ejecutar la función que hace el trabajo hasta que esos jobs estén en `status: "completed"`.
2. **Comprobación antes de ejecutar:** al recibir un evento (p. ej. `datamapping/aggregate-month` para `2026-01`), la función Inngest llama a Convex para:
   - Comprobar que los jobs de ingesta que “cubren” ese mes (p. ej. los 31 `datamapping/extract-day` de enero) estén `completed`, o
   - Comprobar que un job padre “ingest datamapping 2026-01” esté `completed`.
   Si no está listo, se puede **reprogramar** el evento (Inngest `step.sleep` + volver a comprobar) o **fallar** con mensaje claro para reintento posterior.
3. **Orden típico:**
   - `datamapping/aggregate-month` depende de que la ingesta de ese mes esté completa (todos los días o todas las páginas de ese rango).
   - `datamapping/enrich-rfc` puede ejecutarse en paralelo por rango una vez haya datos cargados para ese rango (o depender de un job “ingest range X–Y”).
   - `reconciliation/run` depende de que los datos de las fuentes involucradas estén cargados/actualizados para el scope (opcional: depender de jobs “aggregate” o “ingest” por mes).

Así se evita ejecutar agregación o reconciliación antes de que la ingesta correspondiente haya terminado.

### 3.4 Tamaños de lote y chunks recomendados (~900k)

| Operación | Límite por acción / transacción | Estrategia para ~900k |
|-----------|----------------------------------|------------------------|
| **Ingesta DynamoDB** | ~4k ítems por acción (MAX_ITEMS_PER_ACTION), upsert en batches de 150 | Jobs por día o por “página” (cursor). Cada job = una acción. Varios jobs en paralelo (Inngest fan-out). |
| **Enriquecimiento RFC** | ~550 s por acción, ~150 registros por página, patch 50 por batch | Un job “enrich range” con múltiples steps; cada step actualiza el job (progress, continueState). Inngest re-dispara con `continueState` hasta `isDone`. |
| **Agregación *Datamapping** | ~550 s, PAGE_SIZE 1000, varios meses suman ~900k | Un job por mes; si un mes supera ~100k registros, considerar partir por rango de fechas (mitad de mes) en dos jobs. |
| **Reconciliación** | Ya por scope (month/period); escritura de errors en batches 400 | Un job por `runReconciliation`; progreso vía lectura de `reconciliationSummary` + conteo de `reconciliationErrors` si se necesita. |

Con esto, el sistema escala a ~900k manteniendo cada unidad de trabajo dentro de los límites de Convex y con estado y dependencias claros.

### 3.5 Patrón de cargas masivas (Inngest)

Para ingestas, enriquecimientos, agregaciones y reconciliaciones masivas se sigue un **patrón estándar** documentado en [docs/mass-loads-inngest-pattern.md](docs/mass-loads-inngest-pattern.md):

- **Un step por unidad** (p. ej. un mes): reintentos granulares; si falla una unidad, solo esa se reintenta.
- **Ejecución en paralelo** (`Promise.all` de steps) cuando sea posible.
- **Chunks** dentro de cada step para no superar timeouts (524/600s).
- **Promise.allSettled** y resultado con **completedUnits** / **failedUnits** (p. ej. `completedMonths`, `failedMonths`) para saber qué terminó bien y en qué enfocarse.

Implementación de referencia: `datamapping-full-history` (26 meses en paralelo, resultado con `byMonth`, `completedMonths`, `failedMonths`, `summary`). El mismo esquema se aplica a enriquecimiento RFC por mes, agregación por mes y reconciliación por mes.

---

## 4. Pipelines por fuente (con Inngest)

Cada pipeline sigue el mismo patrón conceptual: **extracción → limpieza/normalización → enriquecimiento (si aplica) → escritura en Convex → agregación**. Inngest orquesta y paraleliza.

### 4.1 Pipeline CloudWatch

| Paso | Descripción | Inngest | Convex |
|------|-------------|---------|--------|
| Extract | Consulta Logs Insights por día (y opcionalmente por log group). | 1 evento por día → N funciones en paralelo (p. ej. por mes). | - |
| Clean/Normalize | Parse, deduplicación por referencia (payment > v2 > v1). | En la misma función que extrae, o paso siguiente. | - |
| Load | Borrar datos del día e insertar en Convex. | Llama a Convex HTTP action `fetchAndIngestForDate` (o equivalente por día). | `paymentRecords` |
| Aggregate | Recalcular monthStats y tablas de enero/anual. | Evento `cloudwatch/ingest-day-done` → función que llama `buildJanuaryAggregates` para ese mes. | `monthStats`, `rawHourlyData`, … |

**Eventos Inngest (propuesta):**

- `cloudwatch/ingest-date` — data: `{ date: "YYYY-MM-DD" }` → ejecuta extracción + carga para ese día.
- `cloudwatch/aggregate-month` — data: `{ month: "YYYY-MM" }` → reconstruye agregados del mes.

Para “extraer todo un mes”: emitir 31 eventos `cloudwatch/ingest-date` (o los días deseados) en paralelo.

### 4.2 Pipeline DynamoDB (datamapping)

| Paso | Descripción | Inngest | Convex |
|------|-------------|---------|--------|
| Extract | Scan/Query DynamoDB por día (updatedAt) o por rango. | 1 evento por día o por “página” de cursor. | - |
| Clean/Normalize | Mapear ítems DynamoDB a registro normalizado (referencia, monto, fuente, tipoMovimiento, updatedAt, rawJson). | En la misma función. | - |
| Load | Upsert por lotes. | Llama `fetchDatamappingForDayChunk` (por chunk, usado por Inngest histórico), `fetchDatamappingForDay` o `fetchDatamappingAndIngest` (por día o por cursor). | `datamappingRecords` |
| Enrich | Extraer RFC y campos de enriquecimiento de `rawJson`. | Evento `datamapping/load-done` → `datamapping/enrich-rfc` (por rango o por chunk). | `datamappingRecords.rfc`, `enrichmentExtracted` |
| Aggregate | Construir tablas *Datamapping. | Evento `datamapping/enrich-done` o manual → `datamapping/aggregate-month`. | `*Datamapping` |

**Eventos Inngest (propuesta):**

- `datamapping/extract-day` — data: `{ year, month, day }` → `fetchDatamappingForDay` (o `fetchDatamappingForDayChunk` en bucle para histórico completo).
- `datamapping/ingest-page` — data: `{ sinceDate, exclusiveStartKey? }` → `fetchDatamappingAndIngest` (para carga por cursor).
- `datamapping/enrich-rfc` — data: `{ fromDate, toDate }` o `{ continueState }` → `enrichDatamappingWithRfc` (reintentos y continuación por timeout).
- `datamapping/aggregate-month` — data: `{ months: ["YYYY-MM"] }` → `buildDatamappingAggregates`.

“Extraer todo enero” = 31 eventos `datamapping/extract-day` en paralelo.

### 4.3 Pipeline EVO CSV (futuro)

| Paso | Descripción | Inngest | Convex |
|------|-------------|---------|--------|
| Extract | Leer CSV (upload o ruta en almacenamiento). | 1 evento por archivo: `evo-csv/process-file`. | - |
| Clean/Normalize | Validar columnas, fechas, montos; normalizar referencia y fuente = EVO. | En la misma función. | - |
| Load | Insert/upsert en tabla dedicada. | Mutation/action Convex para `evoCsvRecords`. | `evoCsvRecords` |
| Aggregate | Si aplica, actualizar vistas/agregados que combinen EVO CSV con otras fuentes. | Evento `evo-csv/load-done` → agregación. | Por definir |

Formato CSV y schema de `evoCsvRecords` se definirán cuando esté el contrato del archivo.

### 4.4 Pipeline SEI (futuro)

| Paso | Descripción | Inngest | Convex |
|------|-------------|---------|--------|
| Ingest | Recibir indicación de “pagado por V1/V2” (API, webhook o archivo). | Evento `sei/feedback` por lote o por registro. | - |
| Normalize | Mapear a modelo común (referencia, fuente SEI, estado, fecha). | En la misma función. | - |
| Load | Escribir en tabla de retroalimentación. | Mutation/action Convex. | `seiFeedbackRecords` |

Esta tabla se usará para enriquecer la reconciliación (saber si una referencia fue registrada como pagada en SEI por V1/V2) y para detectar problemas de proceso.

---

## 5. Convex: espejos y agregados

- **Espejos por fuente:** cada fuente tiene su tabla “raw” normalizada en Convex para consultas rápidas y reconciliación.
- **Agregados:** se mantienen como hoy (monthStats, rawHourlyData, dailyData, monthlyData, etc. para CloudWatch; *Datamapping para DynamoDB). Para EVO CSV y SEI se pueden añadir tablas de agregados cuando se definan las fuentes.
- **Unificación para análisis:** la reconciliación y los reportes leen de estas tablas en Convex; no llaman a CloudWatch/DynamoDB en tiempo real.

Resumen de tablas (actual + propuesta):

| Tabla | Fuente | Uso |
|-------|--------|-----|
| `paymentRecords` | CloudWatch | Espejo V1/V2/Payment; reconciliación vs DynamoDB. |
| `monthStats`, `rawHourlyData`, … | CloudWatch | Análisis rápido por mes/día/fuente. |
| `datamappingRecords` | DynamoDB | Espejo datamapping; reconciliación; enriquecimiento RFC. |
| `*Datamapping` | DynamoDB | Análisis rápido por mes/día/movimiento. |
| `evoCsvRecords` | EVO CSV | Espejo pagos EVO por archivo (futuro). |
| `seiFeedbackRecords` | SEI | Retroalimentación “pagado por V1/V2” (futuro). |
| `pipelineJobs` | — | Estado de jobs async: tipo, scope, status, progress, result, dependsOnJobIds; para progreso y resultado independientes de la UI. |

---

## 6. Reconciliación

- **Objetivo:** comparar fuentes (hoy: CloudWatch vs DynamoDB) por referencia y monto para encontrar diferencias.
- **Alcance:** se mantiene la lógica actual por scope: `universe`, `month`, `period` (rango de meses).
- **Salida:** `reconciliationSummary` (resumen de la corrida) y `reconciliationErrors` (solo en CW, solo en DDB, mismatch, monthMismatch).

Con más fuentes (EVO CSV, SEI), la reconciliación puede extenderse a:
- Comparar también contra `evoCsvRecords` (p. ej. referencias/montos que están en EVO CSV pero no en CW/DDB).
- Usar `seiFeedbackRecords` para marcar qué referencias SEI considera pagadas por V1/V2 y cruzar con `paymentRecords` y `reconciliationErrors`.

La ejecución de la reconciliación puede dispararse:
- Desde la UI (como hoy).
- Por evento Inngest tras terminar ingestas de un periodo (opcional): p. ej. `reconciliation/run` con `{ scope, month?, startMonth?, endMonth? }`.

---

## 7. Problemas a lo largo de los procesos y re-ejecución

### 7.1 Dónde viven los “problemas”

- **reconciliationErrors (actual):** diferencias concretas por referencia (solo CW, solo DDB, mismatch, monthMismatch). Son el resultado de la reconciliación.
- **Pipeline problems (propuesta):** para trazar fallos o advertencias durante la ingesta/enriquecimiento/agregación (por ejemplo: “falló el día 2026-01-15 de CloudWatch”, “timeout en enriquecimiento RFC”). Se puede añadir una tabla `pipelineRuns` o `pipelineProblems` que guarde:
  - `source` (cloudwatch | dynamodb | evoCsv | sei),
  - `step` (extract | load | enrich | aggregate),
  - `scope` (fecha, mes, runId),
  - `status` (running | completed | failed | partial),
  - `errorMessage`, `affectedRefs` (opcional),
  - `runAt`, `completedAt`.

Así se puede listar “qué falló y en qué paso” y decidir qué re-ejecutar.

### 7.2 Ciclo: encontrar problemas → corregir → re-ejecutar

1. **Encontrar problemas:**
   - **Reconciliación:** revisar `reconciliationErrors` por tipo (onlyCw, onlyDdb, mismatch, monthMismatch) y por mes.
   - **Pipelines:** revisar `pipelineRuns` / `pipelineProblems` para ver fallos de ingesta o enriquecimiento.

2. **Trabajarlos:** corrección en origen (proceso V1/V2, datos en DynamoDB, archivo EVO, etc.) o decisión de re-importar/ajustar datos.

3. **Re-ejecutar:**
   - **Re-ingesta de un día/mes:** emitir eventos Inngest para ese día o mes (p. ej. `cloudwatch/ingest-date`, `datamapping/extract-day`). Inngest puede ejecutar en paralelo varios días.
   - **Re-enriquecimiento:** emitir `datamapping/enrich-rfc` con el rango afectado (o `continueState` si hay timeout).
   - **Re-agregación:** emitir `cloudwatch/aggregate-month` o `datamapping/aggregate-month` para los meses tocados.
   - **Reconciliación:** volver a ejecutar `runReconciliation` para el scope correspondiente (desde UI o vía evento Inngest `reconciliation/run`).

La UI puede ofrecer acciones del tipo “Re-ejecutar ingesta CloudWatch para este mes” o “Re-ejecutar enriquecimiento RFC para este rango”, que internamente envían los eventos a Inngest.

---

## 8. Inngest: integración técnica

- **Dónde corre:** servidor Next.js (API routes o route handlers). Las funciones de Inngest llaman a Convex vía HTTP (Convex HTTP Actions o `ConvexHttpClient` con credenciales de servidor).
- **Eventos:** el frontend o un cron emite eventos; Inngest ejecuta las funciones (en paralelo cuando hay fan-out).
- **Credenciales:** Convex debe ser invocable desde el servidor (env vars en el entorno de Next/Inngest). Para acciones que hoy usan AWS (CloudWatch, DynamoDB), esas credenciales deben estar disponibles en el entorno donde corre Inngest (por ejemplo en Vercel/Node donde se ejecutan las funciones).

Estructura de carpetas sugerida:

```
src/
  app/
    api/
      inngest/
        route.ts          # Webhook Inngest
  inngest/
    client.ts             # createClient
    functions/
      cloudwatch.ts      # ingest-date, aggregate-month
      datamapping.ts     # extract-day, ingest-page, enrich-rfc, aggregate-month
      evoCsv.ts          # process-file (futuro)
      reconciliation.ts  # run (opcional)
```

---

## 9. Orden de implementación sugerido

1. **Tabla `pipelineJobs`** en Convex (schema + mutations para crear/actualizar/consultar jobs). UI puede suscribirse y mostrar lista de jobs con progreso y resultado (estado sobrevive a refresh).
2. **Inngest + pipeline DynamoDB:** eventos `datamapping/extract-day` (fan-out por día) y `datamapping/aggregate-month`; cada ejecución crea/actualiza un job en `pipelineJobs`; `aggregate-month` comprueba dependencias (ingesta del mes completa) antes de ejecutar.
3. **Inngest + pipeline CloudWatch:** eventos `cloudwatch/ingest-date` (fan-out por día) y `cloudwatch/aggregate-month`, con jobs y dependencias análogos.
4. **Reconciliación por evento:** opcionalmente disparar `reconciliation/run` tras ingestas; job de reconciliación con `dependsOnJobIds` si se quiere encadenar.
5. **EVO CSV:** cuando exista formato y contrato, añadir tabla + pipeline + eventos + jobs.
6. **SEI:** cuando exista interfaz (API/webhook/archivo), añadir tabla + pipeline y extender reconciliación.

---

## 10. Resumen

| Tema | Propuesta |
|------|-----------|
| Fuentes | CloudWatch, DynamoDB (actuales); EVO CSV y SEI (futuras). |
| Convex | Espejos normalizados por fuente + agregados para análisis rápido. |
| Escala ~900k | Diseño por límites Convex (acción 10 min, tx 32k docs, return 16 MiB); jobs pequeños (por día/página/mes); lotes acotados. |
| Jobs async | Tabla `pipelineJobs`: estado, progreso, resultado, `dependsOnJobIds`; persistido en Convex para que la UI (y refresh) vea avance y resultado. |
| Dependencias | Ningún job se ejecuta hasta que sus `dependsOnJobIds` estén `completed`; Inngest comprueba en Convex antes de ejecutar (o reprograma). |
| Pipelines | Cada fuente: extracción → limpieza → carga → (enriquecimiento) → agregación; orquestado por Inngest con paralelismo por día/archivo. |
| Reconciliación | Comparar fuentes en Convex; salida en `reconciliationSummary` y `reconciliationErrors`; opcionalmente disparada por Inngest. |
| Problemas | Reconciliación → `reconciliationErrors`; pipelines → `pipelineJobs` (y opcionalmente `pipelineProblems`) para fallos y re-ejecución. |
| Re-ejecución | Desde UI o eventos: re-ingesta (por día/mes), re-enriquecimiento, re-agregación, re-reconciliación, usando Inngest y comprobando dependencias. |

Este documento sirve como base para implementar por fases sin bloquear el uso actual de la aplicación.

**Documentación relacionada**: [docs/mass-loads-inngest-pattern.md](docs/mass-loads-inngest-pattern.md) – Patrón de cargas masivas con Inngest (steps por unidad, paralelo, reintentos, resultado completed/failed).

---

## Anexo: Eventos Inngest (resumen)

| Evento | Data | Acción Convex / efecto |
|--------|------|-------------------------|
| `cloudwatch/ingest-date` | `{ date: "YYYY-MM-DD" }` | Extracción + carga día → `paymentRecords` |
| `cloudwatch/aggregate-month` | `{ month: "YYYY-MM" }` | Rebuild agregados CloudWatch (monthStats, rawHourlyData, …) |
| `datamapping/extract-day` | `{ year, month, day }` | `fetchDatamappingForDay` o `fetchDatamappingForDayChunk` → `datamappingRecords` |
| `datamapping/ingest-page` | `{ sinceDate, exclusiveStartKey? }` | `fetchDatamappingAndIngest` (carga por cursor) |
| `datamapping/enrich-rfc` | `{ fromDate, toDate }` o `{ continueState }` | `enrichDatamappingWithRfc` |
| `datamapping/aggregate-month` | `{ months: ["YYYY-MM"] }` | `buildDatamappingAggregates` |
| `evo-csv/process-file` | `{ fileId, path? }` (futuro) | Carga EVO CSV → `evoCsvRecords` |
| `sei/feedback` | (por definir) | Carga retroalimentación SEI → `seiFeedbackRecords` |
| `reconciliation/run` | `{ scope, month?, startMonth?, endMonth? }` | `runReconciliation` (opcional desde Inngest) |
