# Enriquecimiento DataMapping (RFC, placa, etc.)

## Cómo ejecutar el job

- **Desde la UI:** [Configuración → Carga de fuentes](src/app/configuracion/carga-fuentes/page.tsx), sección **«Enriquecimiento por meses»**. Elegir Mes inicio y Mes fin (YYYY-MM) y pulsar **«Ejecutar enriquecimiento»**. El avance y el resultado del último job se muestran en la misma sección; enlaces a Status de actualizaciones y Operaciones → Runs.
- **Desde la API:** `POST /api/datamapping/enrich-by-months` con body opcional:
  - `{ "start": "2024-01", "end": "2024-01" }` — rango de meses (YYYY-MM)
  - `{ "months": ["2024-01", "2024-02"] }` — lista explícita de meses
  - Sin body — usa por defecto todo el rango configurado (ej. 2024-01 a 2026-02).  
  Respuesta: `{ "ok": true, "jobId": "…" }`. El job se crea con tipo `datamapping_enrichment_by_months` y scope `{ months }`.

## Qué hace el job "Enriquecimiento por meses"

El job enriquece `datamappingRecords` extrayendo de `rawJson` campos como RFC, placa, evoId, status, fuente, etc., y actualizando solo los registros que tienen `enrichmentExtracted === false`. La carga desde DynamoDB ya aplica enriquecimiento en el mismo paso, por lo que este job es para datos cargados antes de ese cambio o tras un backfill que marca registros como no enriquecidos.

## Cuándo termina en segundos con 0 procesados

Si el job **termina en muy poco tiempo** y muestra **0 procesados, 0 enriquecidos**, significa:

- **Todo el rango solicitado está ya enriquecido.**  
  Antes de procesar cada mes se hace un precheck con el índice `by_enrichmentExtracted_updatedAt`: si no existe ningún registro con `enrichmentExtracted === false` en ese mes, la unidad de ese mes se marca como completada de inmediato sin leer ni actualizar registros. Si todos los meses del rango están en ese caso, el job termina en segundos.

En resumen: **0 procesados = no había trabajo que hacer = todo estaba al día.**

## Cómo comprobarlo

- En **Configuración → Carga de fuentes**, sección «Enriquecimiento por meses»: el último job muestra procesados/enriquecidos al completar; si hay un botón **«Calcular pendientes»** (o similar), usarlo para ver cuántos registros tienen `enrichmentExtracted === false` por mes. Si todos los meses muestran 0, todo está enriquecido.
- En **Configuración → Enriquecimiento y agregaciones** (si existe) se muestra si hay meses con registros pendientes de enriquecer (query rápida por mes).
- En **Operaciones → Runs** y Run Detail puede verse el resultado del job (`totalProcessed`, `totalEnriched`, `byMonth`).

## Flujo técnico

1. Precheck a nivel mes: `hasPendingEnrichmentForMonth(month)` (una lectura por mes).
2. Si no hay pendientes en el mes → unidad completada con `skipped: true`, `processed: 0`, `enriched: 0`.
3. Si hay pendientes → se recorre día a día; por cada día `hasPendingEnrichmentForDay(month, day)`; si no hay pendientes ese día se salta; si hay, se llama a `enrichDatamappingWithRfc` para ese día hasta terminar.
4. El progreso parcial (procesados/enriquecidos) se escribe en `pipelineJobUnits.progressDetail` para que la UI muestre avance mientras corre. La actualización de progreso se hace mediante la action `updatePipelineUnitProgressWithRetry`, que reintenta ante errores de concurrencia (OCC) de Convex; ver [07-observabilidad-reintentos-y-recuperacion.md](07-observabilidad-reintentos-y-recuperacion.md#reintentos-ante-occ-convex).
