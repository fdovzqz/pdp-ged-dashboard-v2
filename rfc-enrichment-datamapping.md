# Enriquecimiento RFC y campos extra en datamappingRecords

**Desde la refactorización: el enriquecimiento se hace en la carga.** Al extraer desde DynamoDB (fetchDatamappingForDay, fetchDatamappingForMonth, fetchDatamappingAndIngest, fetchDatamappingIncremental, fetchDatamappingForDayChunk), cada registro se mapea, se extraen RFC y campos (placa, evoId, etc.) del rawJson con `extractEnrichmentFieldsFromRawJson`, y se hace upsert con esos campos y `enrichmentExtracted: true`. Un solo paso; no hay job de enriquecimiento ni backfill por separado.

Este documento conserva la descripción del schema, campos e índices. La lógica de extracción está en `convex/lib/dynamodb.ts` (`extractEnrichmentFieldsFromRawJson`) y se invoca en las acciones de carga en `convex/actions.ts` (helper `withEnrichment`).

---

## Objetivos

| Objetivo | Cómo se cumple |
|----------|----------------|
| Campo indexado `rfc` en Convex | Se extrae de `rawJson` y se guarda con `patchDatamappingRfcBatch`. |
| No reprocesar lo ya enriquecido | Índice por `enrichmentExtracted`; solo se consultan registros con `enrichmentExtracted: false`. |
| Progreso y reanudación | Preflight opcional para el total; acción devuelve `continueState` si hay timeout. |
| Evitar barrido doble | El conteo no se hace dentro de la acción de enriquecer; solo en "Calcular pendientes" (preflight). |

---

## Schema (datamappingRecords)

Campos relevantes:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `rawJson` | string | JSON crudo del registro en DynamoDB (ahí vienen RFC y demás campos). |
| `rfc` | string (opc.) | RFC extraído por el ETL; indexado para búsquedas. |
| `enrichmentExtracted` | boolean (opc.) | `true` = ya enriquecido; `false` = pendiente. Bandera que controla el flujo. |
| `placa` | string (opc.) | Placa/plate extraída de rawJson. |
| `evoId`, `codiId`, `expirationDate`, `folioNumber`, `loteId`, `procedureCategory`, `tramiteId`, `userId` | string (opc.) | Campos extraídos por enriquecimiento (claves camelCase/snake_case en rawJson). |

Índices usados:

| Índice | Campos | Uso |
|--------|--------|-----|
| `by_tipoMovimiento_updatedAt` | tipoMovimiento, updatedAt | Consulta legacy (deprecated para enriquecimiento). |
| `by_enrichmentExtracted_updatedAt` | enrichmentExtracted, updatedAt | **Solo registros pendientes** (`enrichmentExtracted: false`) por rango de fechas. |

Con `enrichmentExtracted` se consulta únicamente el subset que falta por enriquecer.

---

## Flujo de datos

```
                    ┌─────────────────────────────────────────────────────────┐
                    │  datamappingRecords (enrichmentExtracted: false, rango)  │
                    └─────────────────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
    ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐
    │ getDatamappingIds     │  │ getDatamappingPage    │  │ getDatamappingPage    │
    │ NeedingEnrichment     │  │ WithRawJsonNeeding    │  │ IdForBackfill   │
    │ (solo _id, preflight) │  │ Enrichment (rawJson   │  │ (solo _id, backfill   │
    │                       │  │  para enriquecer)     │  │  enrichment 1 vez)    │
    └───────────────────────┘  └───────────────────────┘  └───────────────────────┘
                │                           │                           │
                ▼                           ▼                           ▼
    getDatamappingEnrichment     enrichDatamappingWithRfc      backfillDatamapping
    Preflight (opcional)         (extrae RFC + campos,        EnrichmentExtracted
                                 patch batch)                 (1 vez)
```

---

## Queries (convex/queries.ts)

### getDatamappingPageWithRawJsonNeedingEnrichment

- **Uso:** Enriquecer; solo registros con `enrichmentExtracted === false` en el rango de fechas (no filtra por tipo de movimiento).
- **Índice:** `by_enrichmentExtracted_updatedAt` con `enrichmentExtracted: false`.
- **Args:** `updatedAtFrom`, `updatedAtTo`, `cursor`, `numItems` (default 150).
- **Devuelve:** Página con `_id`, `referencia`, `monto`, `updatedAt`, `tipoMovimiento`, `fuente`, `rawJson`, `rfc`.

### getDatamappingIdsNeedingEnrichment

- **Uso:** Conteo rápido (preflight) sin transferir `rawJson`.
- **Mismo índice y filtros** que la anterior; solo devuelve `_id` por ítem.
- **Args:** `updatedAtFrom`, `updatedAtTo`, `cursor`, `numItems` (default 2000).

### getDatamappingPageIdForBackfill

- **Uso:** Backfill único de `enrichmentExtracted` (marcar todos con `false` en una sola pasada).
- **Índice:** `by_updatedAt` (rango fijo 2000–2031).
- **Devuelve:** Página de `{ _id }` para llamar a `backfillDatamappingEnrichmentExtractedBatch`.

### getDatamappingPageWithRawJsonByTipoMovimientoAndDateRange

- **Estado:** Deprecated para el flujo de enriquecimiento. Usar `getDatamappingPageWithRawJsonNeedingEnrichment`.

---

## Mutations (convex/mutations.ts)

### patchDatamappingRfcBatch

- **Args:** `updates: { id, rfc, ...campos opcionales de enriquecimiento }[]`.
- **Efecto:** Para cada ítem, `patch(id, { rfc: valor normalizado, enrichmentExtracted: true, ... })`.
- Se usa en lotes de 50 dentro de la acción de enriquecimiento. La bandera que importa es `enrichmentExtracted`.

### upsertDatamappingBatch

- Al insertar o actualizar desde DynamoDB se fija **`enrichmentExtracted: false`** para que el registro sea elegible para el enriquecimiento.

### backfillDatamappingEnrichmentExtractedBatch

- **Args:** `updates: { id, enrichmentExtracted }[]`.
- **Efecto:** Actualiza el campo `enrichmentExtracted` en lote (p. ej. `false` en todos para el backfill único).

---

## Actions (convex/actions.ts)

### getEnrichmentDateRange (helper interno)

- Calcula `updatedAtFrom` / `updatedAtTo` a partir de `fromDate` y `toDate`.
- Usado por preflight y por `enrichDatamappingWithRfc`.

### getDatamappingEnrichmentPreflight

- **Args:** `fromDate`, `toDate` (opc.).
- **Comportamiento:** Pagina `getDatamappingIdsNeedingEnrichment` en el rango y suma. No pide `rawJson`, solo IDs.
- **Devuelve:** `totalToProcess`, `updatedAtFrom`, `updatedAtTo`.

### enrichDatamappingWithRfc

- **Args:** `fromDate`, `toDate` (opc.), `continueState` (opc., para reanudar), `maxDurationMs` (opc.).
- **Comportamiento:**
  1. Obtiene `updatedAtFrom`, `updatedAtTo` vía `getEnrichmentDateRange` (o desde `continueState` al reanudar).
  2. Pagina `getDatamappingPageWithRawJsonNeedingEnrichment` (150 por página) por cursor; no filtra por tipo de movimiento.
  3. Por cada registro: extrae RFC + placa, evoId, etc. con `extractEnrichmentFieldsFromRawJson`; cada 50 ítems llama `patchDatamappingRfcBatch` (marca `enrichmentExtracted: true`).
  4. Si se supera el límite de tiempo, devuelve `continueState: { cursor, updatedAtFrom, updatedAtTo }` para reanudar.
- **Devuelve:** `processed`, `enriched`, `isDone`, y opcionalmente `timedOut`, `message`, `continueState`.

### backfillDatamappingEnrichmentExtracted

- **Args:** `cursor` (opc., para reanudar).
- **Comportamiento:** Pagina `getDatamappingPageIdForBackfill` (solo `_id`) y, por cada página, llama `backfillDatamappingEnrichmentExtractedBatch`: pone **`enrichmentExtracted: false`** en todos y elimina el campo legacy **`rfcExtracted`** (`patch` con `rfcExtracted: undefined`). Así todos quedan pendientes y el siguiente enriquecimiento los procesará. Tras ejecutar el backfill en toda la tabla (~900k), se puede eliminar `rfcExtracted` del schema.
- **Uso:** Ejecutar **una sola vez** tras añadir el campo/índice `enrichmentExtracted`, para que todas las filas tengan el flag y la query por `enrichmentExtracted: false` devuelva los pendientes.

---

## Extracción (convex/lib/dynamodb.ts)

- **extractRfcFromRawJson(rawJson: string): string | undefined**  
  Parsea el JSON y busca el RFC en estructuras conocidas del payload (p. ej. contribuyente, datos fiscales). Si no encuentra, devuelve `undefined`.

- **extractEnrichmentFieldsFromRawJson(rawJson: string): EnrichmentFields**  
  Extrae RFC (vía `extractRfcFromRawJson`) y los campos opcionales: placa, evoId, codiId, expirationDate, folioNumber, loteId, procedureCategory, tramiteId, userId. Para cada campo se buscan varias claves (camelCase, snake_case, alias) a nivel raíz del objeto parseado; el primer valor no vacío se normaliza a string.

---

## Enriquecimiento por meses (Inngest)

El enriquecimiento puede ejecutarse **por meses en paralelo** vía Inngest (misma estrategia que la carga histórica de DataMapping):

- **Evento:** `reconciliation/datamapping.enrich-by-months` (payload: `{ jobId }`).
- **Función Inngest:** `datamapping-enrichment-by-months` en `src/inngest/datamapping-enrichment-by-months.ts`. Un step por mes (2024-01 … 2026-02); dentro de cada step, bucle con `enrichDatamappingWithRfc` y `continueState` hasta `isDone`. Resultado en `pipelineJobs.result`: `completedMonths`, `failedMonths`, `byMonth`, `summary`.
- **API:** POST `/api/datamapping/enrich-by-months` crea el job y envía el evento.
- **UI (Jobs):** En la sección “Enriquecer datamapping con RFC”, el botón **“Enriquecer datamapping por meses”** llama a esa API; el job aparece en la lista de jobs con tipo `datamapping_enrichment_by_months` y al completar se ve el resultado por mes.

---

## UI (Datos / Jobs)

| Control | Acción | Cuándo usarlo |
|--------|--------|----------------|
| **Desde / Hasta (fecha)** | Rango `updatedAt` para preflight y enriquecer. | Definir el periodo a procesar. |
| **Calcular pendientes** | `getDatamappingEnrichmentPreflight`. Muestra “Registros pendientes: N”. | Opcional; para saber cuántos faltan sin ejecutar el enriquecimiento. |
| **Enriquecer datamapping con RFC** | `enrichDatamappingWithRfc`. Procesa solo registros con `enrichmentExtracted: false` en ese rango. | Cada vez que quieras enriquecer (o reanudar). |
| **Enriquecer datamapping por meses** | POST `/api/datamapping/enrich-by-months` → Inngest; un step por mes en paralelo. | Enriquecer todo el rango histórico (2024-01 … 2026-02) en paralelo. |
| **Continuar enriquecimiento** | Misma acción con el `continueState` guardado (tras timeout). | Cuando la acción devuelve “tiempo agotado” y mensaje de reanudar. |
| **Preparar enrichmentExtracted (1 vez)** | `backfillDatamappingEnrichmentExtracted`. Marca `enrichmentExtracted: false` en todos. | Una vez tras añadir el campo/índice, si ya había datos en `datamappingRecords`. |

El resultado del enriquecimiento muestra “Procesados: X · Con RFC extraído: Y”. Si antes se ejecutó “Calcular pendientes”, se puede mostrar también el total de pendientes en la sección correspondiente.

---

## Orden recomendado

1. **Primera vez (o tras añadir `enrichmentExtracted` con datos ya cargados)**  
   Ejecutar **“Preparar enrichmentExtracted (1 vez)”** para marcar todos los registros con `enrichmentExtracted: false`. En tablas ~900k la acción puede hacer timeout; usar "Continuar backfill" para reanudar.

2. **Opcional**  
   Indicar rango de fechas y pulsar **“Calcular pendientes”** para ver cuántos registros se procesarían.

3. **Enriquecer**  
   Mismo rango y pulsar **“Enriquecer datamapping con RFC”**. Si hay timeout, volver a pulsar (o “Continuar enriquecimiento”) para reanudar con el mismo rango.

4. **Uso del RFC**  
   Los RFC quedan en `datamappingRecords.rfc` y se usan en la búsqueda por RFC (p. ej. RFC Referencias).

---

## Límites y rendimiento

- **Límite de acción Convex:** 600 s; las acciones se detienen a los 550 s y devuelven estado para reanudar.
- **Escala:** Diseñado para tablas de **~900k** documentos. Backfill y enriquecimiento son **reanudables** (timeout 550 s; "Continuar" en la UI).
- **Backfill:** Lotes de 400; con ~900k puede requerir varias ejecuciones hasta "Completado".
- **Enriquecimiento:** 150 por página; 50 por `patchDatamappingRfcBatch`; solo registros con `enrichmentExtracted: false`.
- **Evitar barrido doble:** El historial de ejecuciones se consulta en la tabla de estado.

---

## Casos edge

| Caso | Comportamiento |
|------|----------------|
| **Registros sin RFC en el JSON** | Se marcan igualmente como `enrichmentExtracted: true` y se guarda `rfc: ""`. Así no se reprocesan en ejecuciones posteriores. |
| **Orden obligatorio** | Ejecutar **backfill** (“Preparar tabla”) antes de enriquecer. Los documentos con `enrichmentExtracted` ausente (`undefined`) no coinciden con la query `enrichmentExtracted: false` en el índice; el backfill los normaliza a `true` o `false`. |

---

## Referencias en código

| Concepto | Ubicación |
|----------|-----------|
| Schema `datamappingRecords`, `rfcEnrichmentRuns` | `convex/schema.ts` |
| Queries de “needing RFC” y backfill | `convex/queries.ts` |
| Mutations de RFC/enriquecimiento y backfill | `convex/mutations.ts` |
| Enrich y backfill (reanudables, 550 s) | `convex/actions.ts` |
| Extracción RFC y campos de enriquecimiento | `convex/lib/dynamodb.ts` → `extractRfcFromRawJson`, `extractEnrichmentFieldsFromRawJson` |
| UI Jobs / enriquecimiento RFC y por meses | `src/app/jobs/page.tsx` |
| Inngest enriquecimiento por meses | `src/inngest/datamapping-enrichment-by-months.ts` |
| API enriquecimiento por meses | `src/app/api/datamapping/enrich-by-months/route.ts` |
