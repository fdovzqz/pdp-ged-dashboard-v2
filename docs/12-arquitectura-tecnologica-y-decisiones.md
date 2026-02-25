# Arquitectura tecnologica y decisiones (target)

## Objetivo

Dejar explicito que stack se usara para el engine configurable, que se mantiene del estado actual y que tecnologias se reconsideran por fase.

## Contexto actual

- Orquestacion principal en Convex (`pipelineJobs`, `pipelineJobUnits`, actions/mutations).
- APIs de entrada en Next.js.
- Integraciones con AWS (CloudWatch y DynamoDB).
- Inngest removido para pipelines principales.

## Decision macro

Se mantiene la estrategia de **refactor mayor evolutivo sobre base Convex** y no greenfield inmediato.  
El engine de workflows se construye sobre el runtime actual, encapsulando la logica en reglas/versiones en lugar de flujos hardcodeados.

## Decisiones por tecnologia

## 1) Convex

- **Estado:** `Adoptar y consolidar (Now)`
- **Rol:** runtime principal de orquestacion, estado, checkpoints, reintentos y auditoria.
- **Motivo:** ya esta en produccion del flujo actual y minimiza riesgo de transicion.

## 2) Inngest

- **Estado:** `No usar como orquestador principal (Now)` / `Reconsiderar (Later, opcional)`
- **Rol actual:** fuera del camino critico.
- **Cuándo reconsiderar:** solo para casos puntuales event-driven externos, no para el core ETL/reconciliacion.
- **Criterio de reingreso:** si aparece requerimiento fuerte de integraciones externas/event bus que Convex no cubra eficientemente.

## 3) Zod

- **Estado:** `Adoptar (Now)`
- **Rol:** validacion de contratos de configuracion de workflow, reglas y payloads de steps.
- **Alcance inicial:** schemas para `WorkflowVersion`, `StepConfig`, `RetryPolicy`, `QualityCheckConfig`.
- **Motivo:** reducir errores de configuracion y hacer fallos tempranos, legibles y auditables.

## 4) Effect (Effect-TS)

- **Estado:** `Adopcion gradual (Pilot -> Later)`
- **Rol propuesto:** manejo tipado de errores, composicion de pipelines y politicas de retry/circuit-breaker de alto nivel.
- **Decision actual:** no bloquear el avance por migracion completa a Effect; iniciar con pilotos en etapas de mayor complejidad (extraction/reconciliation).
- **Criterio de escalado:** mejora medible en robustez y mantenibilidad sin degradar productividad del equipo.

## 5) Otras tecnologias evaluadas

### Temporal

- **Estado:** `Descartar por ahora`
- **Razon:** sobrecosto de plataforma para el estado actual; duplicaria responsabilidades que ya cubre Convex en esta fase.

### BullMQ / Redis queues

- **Estado:** `Descartar por ahora`
- **Razon:** introduce infraestructura adicional y complejidad operativa sin resolver mejor el problema central de reglas/versionado.

### OpenTelemetry

- **Estado:** `Recomendado (Later, fase observabilidad avanzada)`
- **Rol:** estandar de trazas y correlacion cross-service.

### JSON Schema puro (sin runtime TS)

- **Estado:** `Complementario`
- **Rol:** versionado documental de contratos; combinado con Zod para validacion en runtime.

## Stack objetivo por capas

- **Orquestacion y estado:** Convex.
- **Contratos y validacion:** TypeScript estricto + Zod.
- **Reglas de negocio:** RuleSets versionados (DSL JSON + validacion Zod).
- **Errores y resiliencia:** estrategia actual + pilotos de Effect.
- **Observabilidad:** eventos estructurados en Convex + evolucion a OTel.
- **UI operacional:** Next.js + dashboard de corridas/calidad/auditoria.

## Politica de adopcion por fases

1. **Fase 1 (Now):** Convex + Zod en contratos criticos + observabilidad base.
2. **Fase 2:** Rule engine versionado + quality gates obligatorios.
3. **Fase 3:** pilotos Effect en pasos complejos.
4. **Fase 4:** decision de escalar Effect y/o OTel segun evidencia.

## Lista explicita: que se va a usar

### Usar ahora

- Convex (core engine y estado)
- Next.js (API/UI)
- AWS SDK (CloudWatch/DynamoDB)
- TypeScript estricto
- Zod (config/rules/contracts)

### Reconsiderar

- Effect (adopcion gradual por pilotos)
- OpenTelemetry (trazas avanzadas)
- Inngest (solo casos especificos no core)

### No usar por ahora

- Temporal
- BullMQ/Redis como orquestador paralelo del core
