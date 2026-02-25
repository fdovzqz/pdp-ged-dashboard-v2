# Refactor: cutover big-bang y criterios de aceptación

## Objetivo
Documentar el proceso de integración total, validación y cutover, y los criterios de sign-off para la versión funcional completa.

## Estado de implementación (post-refactor)

- **Núcleo configurable:** Zod (WorkflowVersion, StepConfig, RetryPolicy, QualityCheckConfig), registro de handlers por jobType, dependencias reales (dependsOnJobIds).
- **ETL y reglas:** Pipeline stages, RuleSets versionados (dedup, reconciliation, enrichment), prioridad CloudWatch desde RuleSet.
- **Calidad y reintentos:** strictMode en scope (quality gate), retryPipelineUnit y retryFailedUnits.
- **Observabilidad y auditoría:** auditEvents (run.started, unit.completed/failed, run.completed/failed), getAuditEventsForJob, getAuditEvidenceForJob.
- **UI operativa:** Control Center, Runs, Run Detail, Error Center, Retry Center, Rules Catalog, Sources Catalog, Audit & Evidence.
- **Catálogos con datos reales:** Rules Catalog consume `ruleSets.listRuleSets` (RuleSets por dominio/sourceKey). Sources Catalog consume `sources.listSources` (fuentes cloudwatch y datamapping con job types derivados del registry).

## Estandarización de nombres (refactor 2026-02)

API Convex agrupada por **dominio**; cada dominio expone queries, mutations y/o actions en módulos dedicados.

### Módulos por dominio

| Dominio | Queries | Mutations | Actions |
|--------|---------|-----------|---------|
| **CloudWatch** | `cloudwatchQueries` | `cloudwatchMutations` | `cloudwatchActions` |
| **DataMapping** | `datamappingQueries` | `datamappingMutations` | `datamappingActions` |
| **Reconciliación** | `reconciliationQueries` | `reconciliationMutations` | `reconciliationActions` |
| **Pipeline** | `pipelineQueries` | `pipelineMutations` | `pipelineActions` |
| **Agregados CW** | `aggregatesCloudwatchQueries` | `aggregatesCloudwatchMutations` | — |
| **Agregados DM** | `aggregatesDatamappingQueries` | — | — |
| **ETL agregados** | — | — | `aggregatesCloudwatchETL`, `datamappingETL` |

- **`actions`** queda como barrel que re-exporta `cloudwatchActions`, `datamappingActions` y `reconciliationActions`; las llamadas `api.actions.*` siguen funcionando.
- Eliminados los stubs vacíos `queries.ts` y `mutations.ts` (todo migrado a los módulos por dominio).
- Pipeline unificado: antes repartido en `pipelineJobs`, `pipelineRunner`, `pipelineRunnerMutations`; ahora en `pipelineQueries`, `pipelineMutations`, `pipelineActions`.

### Nombres de tablas

Convención documentada en **`docs/convencion-nombres-tablas.md`**: prefijos por dominio/uso (cloudwatch, cloudwatchAgg, datamapping, datamappingAgg, pipeline, reconciliation, etl, config, app). Aplicación opcional: solo para tablas nuevas, o migración por fases (crear tablas nuevas, migrar datos, actualizar referencias).

## Cutover: cuándo darlo por terminado

Se puede **considerar el cutover terminado** cuando:
1. La batería de pruebas (pre-cutover) está ejecutada y pasando.
2. Los criterios de aceptación A–E están verificados (sign-off).
3. Monitoreo post-cutover no muestra regresiones.

A partir de ahí se procede a la **fase final**: validación en producción, corridas de prueba acordadas y, una vez estables, **ejecutar el plan de remoción de código no utilizado** (ver más abajo) para dejar el código en buen estado para mantenimiento.

## Checklist de cutover big-bang

1. **Pre-cutover**
   - [ ] Ejecutar batería de pruebas sobre datasets representativos (al menos un rango de fechas completo para CloudWatch y datamapping).
   - [ ] Verificar que todos los jobTypes existentes ejecutan correctamente vía handler registry.
   - [ ] Verificar que scope.strictMode bloquea finalización cuando hay unidades fallidas.
   - [ ] Verificar que retryFailedUnits y retryPipelineUnit reprograman unidades.
   - [ ] Congelar cambios de reglas en ventana de release.

2. **Cutover**
   - [ ] Desplegar backend (Convex) y frontend (Next) con la nueva versión.
   - [ ] Activar límites de concurrencia conservadores en primer despliegue.
   - [ ] Redirigir tráfico o sustituir rutas legacy según estrategia acordada.

3. **Post-cutover**
   - [ ] Monitoreo intensivo: runs fallidos, duración, eventos de auditoría.
   - [ ] Rampa supervisada de concurrencia si todo estable.

## Criterios de aceptación (sign-off)

### A. Cobertura funcional completa
- [ ] 100% de los flujos actuales operan sobre el engine configurable (handler registry).
- [ ] UI operativa publicada con todas las pantallas (Control, Runs, Run Detail, Errors, Retries, Rules, Sources, Audit).

### B. Robustez operativa
- [ ] Ninguna corrida se marca completed si hay pasos críticos fallidos cuando scope.strictMode es true.
- [ ] Reintento manual (retryPipelineUnit, retryFailedUnits) disponible y verificado.
- [ ] Recuperación desde checkpoint (unidades fallidas reencoladas) validada.

### C. Calidad y consistencia
- [ ] Reglas de dedup aplicadas desde RuleSet cuando existe (CloudWatch).
- [ ] Idempotencia en re-ejecuciones controladas.

### D. Observabilidad y auditoría
- [ ] 100% de corridas con trail auditable (auditEvents).
- [ ] Export de evidencia por corrida (getAuditEvidenceForJob) disponible.
- [ ] Run Detail: listas de unidades completadas/pendientes, registros procesados por día y total, auditoría con unitKey y conteo por evento (ver docs/07 y docs/13).

### E. Adaptabilidad futura
- [ ] Onboarding de nueva fuente documentado (adapter + reglas + config).
- [ ] Contratos frontend/backend versionados (Zod en config).

## Recomendación
Ejecutar el checklist en orden y marcar cada ítem al completarlo. El sign-off de versión funcional completa se considera cerrado cuando todos los criterios A–E están verificados.

---

## Plan de remoción de código no utilizado (post sign-off)

Objetivo: eliminar código legacy o redundante tras la validación y las corridas de prueba para evitar confusión y dejar el código en buen estado para mantenimiento.

### 1. Inngest (opcional)

- Los pipelines ya corren 100% en Convex; Inngest solo conserva `testPing` para pruebas.
- **Opciones:**
  - **A)** Si no se usa Inngest para nada más: eliminar `src/inngest/` (client, functions), `src/app/api/inngest/route.ts`, `src/app/api/test-inngest/route.ts` y referencias en `vercel.json` si las hay. Desinstalar dependencia `inngest` si queda huérfana.
  - **B)** Mantener el mínimo (ruta + testPing) por si se quiere usar Inngest para jobs no-pipeline en el futuro.

### 2. Rutas API y referencias

- Revisar que todas las rutas bajo `src/app/api/datamapping/*` y `src/app/api/cloudwatch/*` sigan siendo las únicas entradas para disparar jobs (UI o integraciones). Cualquier ruta que ya no se llame desde la UI ni desde ningún cliente: documentar y eliminar en una PR dedicada.
- Revisar `vercel.json`: redirecciones o rewrites obsoletas (p. ej. rutas legacy) y eliminarlas.

### 3. Código muerto en Convex

- Queries/mutations/actions que solo usaban los flujos antiguos (pre-engine): identificar con búsqueda de referencias, documentar y eliminar en bloque (o mover a un módulo `_deprecated` con comentario de eliminación en la siguiente versión).
- La API ya está en módulos por dominio (`cloudwatchQueries`, `datamappingMutations`, etc.); `api.queries` y `api.mutations` no existen (stubs eliminados). Opcional: dejar de usar el barrel `api.actions.*` y usar `api.cloudwatchActions.*`, `api.datamappingActions.*`, `api.reconciliationActions.*` en todo el código.

### 4. Frontend

- Páginas o componentes que solo servían a flujos ya reemplazados por Operaciones (Control Center, Runs, etc.): marcar como obsoletos o eliminar con una PR de limpieza, actualizando navegación y enlaces.

### 5. Documentación y configuración

- Confirmar que `docs/archivo/` contiene solo histórico y que el índice en `docs/README.md` está actualizado.
- Revisar `README.md` raíz: que describa el estado actual (engine configurable, Convex, catálogos operativos) y enlaces a Operaciones y a este documento.
- Para nombres de tablas nuevas o migraciones: seguir `docs/convencion-nombres-tablas.md` (prefijos por dominio: cloudwatch, datamapping, pipeline, reconciliation, etl, config, app).
- Limpiar variables de entorno o secretos de ejemplo que ya no apliquen (p. ej. referencias a Inngest si se elimina).

### Orden sugerido

1. Completar sign-off (criterios A–E).
2. Ejecutar validación y corridas de prueba en el entorno objetivo.
3. Aplicar el plan de remoción en este orden: (1) Inngest si aplica, (2) rutas API no usadas, (3) Convex muerto, (4) frontend obsoleto, (5) docs y config.
4. Una vez removido: commit en rama dedicada, revisión y merge; actualizar este doc con "Remoción completada en [fecha]".

---

## Remoción completada (2026-02-22)

- **Inngest:** Eliminados `src/inngest/` (client, functions), `src/app/api/inngest/route.ts`, `src/app/api/test-inngest/route.ts` y dependencia `inngest` de package.json. Los pipelines corren 100% en Convex.
- **Rutas API:** Eliminadas `/api/datamapping/backfill-enrichment-by-months`. **Reincorporada** `POST /api/datamapping/enrich-by-months` (body opcional: `months`, `start`/`end` en YYYY-MM) para el job `datamapping_enrichment_by_months`; la UI en **Configuración → Carga de fuentes**, sección «Enriquecimiento por meses», usa esta ruta. Eliminadas `/api/v1/payments-by-day`, `/api/explore` y página `/v1` (página legacy de exploración CloudWatch); añadida redirección `/v1` → `/operaciones`.
- **Convex:** Tablas `workflowDefinitions` y `workflowVersions` eliminadas del schema (no usadas; engine usa registro estático). Eliminados stubs `queries.ts` y `mutations.ts` (contenido migrado a módulos por dominio). Pipeline unificado en `pipelineQueries`, `pipelineMutations`, `pipelineActions` (eliminados `pipelineJobs`, `pipelineRunner`, `pipelineRunnerMutations`). Actions agrupadas por dominio en `cloudwatchActions`, `datamappingActions`, `reconciliationActions`; `actions.ts` queda como barrel de re-export.
- **Frontend:** Sin páginas obsoletas eliminadas además de `/v1`; navegación actual (Nav, Operaciones, Configuración, Reconciliación) se mantiene.
- **Docs:** README raíz actualizado con enlace a Operaciones y a este documento. Diagrama en `docs/04-modelo-de-datos-y-auditoria.md` actualizado tras eliminar workflowDefinitions/workflowVersions. Añadido `docs/convencion-nombres-tablas.md` con convención de prefijos por dominio/uso para tablas (aplicable a tablas nuevas o por migración).
