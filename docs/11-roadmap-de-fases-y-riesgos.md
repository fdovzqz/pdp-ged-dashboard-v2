# Roadmap de fases y riesgos

## Estrategia

Aplicar refactor mayor evolutivo por fases, con criterio de salida medible por fase.

## Fase 0: Fundaciones documentales y gobernanza

Entregables:

- taxonomia de workflows y reglas
- contratos de datos y auditoria
- quality gates iniciales

Riesgo principal: ambiguedad en definiciones.
Mitigacion: aprobacion formal de glosario y contratos.

## Fase 1: Runtime base del engine

Entregables:

- planner/scheduler/executor basicos
- estados de corrida y unidad
- retry y checkpoint minimos

Riesgo principal: regresiones operativas.
Mitigacion: coexistencia controlada con flujo actual.

## Fase 2: ETL configurable + quality gates

Entregables:

- pipeline declarativo por etapas
- reglas de dedup y reconciliacion versionadas
- quality checks obligatorios

Riesgo principal: reglas incompletas.
Mitigacion: validaciones y dry-runs previos.

## Fase 3: Observabilidad y auditoria completa

Entregables:

- eventos estandarizados end-to-end
- dashboard operativo
- export de evidencia auditiva

Riesgo principal: sobrecarga de logging.
Mitigacion: niveles de detalle y politicas de retencion.

## Fase 4: Hardening y escalamiento

Entregables:

- tuning de concurrencia y costos
- resiliencia avanzada (circuit breaker, backpressure)
- readiness para siguientes fases complejas

Riesgo principal: costo operacional.
Mitigacion: umbrales y control de capacidad por workflow.

## Criterios de avance entre fases

- cumplimiento de criterios de aceptacion de la fase previa
- evidencia auditiva disponible
- sin incremento neto de errores criticos
- validacion de stakeholders operativos
