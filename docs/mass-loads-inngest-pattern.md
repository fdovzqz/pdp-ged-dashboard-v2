# Patrón: Cargas masivas con Inngest

Este documento describe la **manera estándar** de hacer cargas masivas (y operaciones similares) en el proyecto: orquestación con Inngest, unidades de trabajo por step, ejecución en paralelo, reintentos por unidad y resultado explícito de qué completó y qué falló. El mismo patrón aplica a **ingestas**, **enriquecimientos**, **agregaciones** y **reconciliaciones**.

---

## Objetivos del patrón

1. **Escalar** sin superar límites (timeout 524/600s, 16MB Convex): cada step hace trabajo acotado.
2. **Reintentos granulares**: si falla una unidad (p. ej. un mes), solo esa se reintenta; el resto ya está en checkpoint.
3. **Visibilidad clara**: al final saber qué unidades terminaron bien, cuáles fallaron tras reintentos y enfocarse en esas.
4. **Paralelismo**: lanzar muchas unidades en paralelo cuando sea posible (p. ej. 26 meses a la vez).

---

## Componentes del patrón

### 1. Una unidad de trabajo = un step

- No un solo step que procesa todo (si falla, se pierde todo y se reintenta todo).
- **Un step por unidad** (p. ej. un step por mes: `extraer-mes-2024-01`, `extraer-mes-2024-02`, …).
- Cada step es **independiente**: si uno falla, Inngest reintenta solo ese step (según `retries` de la función).
- En el dashboard de Inngest (Runs) se ve cada step, su duración y, si hubo reintentos, **Attempt 0**, **Attempt 1**, **Attempt 2**: así se distingue “falló pero el reintento lo solucionó” (último attempt en verde) de “falló en todos los intentos” (todos en rojo).

### 2. Chunks dentro del step (evitar timeout)

- Dentro de cada step, si una unidad puede ser muy grande (p. ej. un mes con 30k registros), **no** hacer una sola llamada HTTP larga a Convex.
- Procesar por **chunks** (p. ej. una página DynamoDB por request): muchas llamadas cortas (`fetchDatamappingForDayChunk` en bucle hasta `hasMore === false`). Así cada request termina en &lt; ~90s y se evitan 524/600s.
- **En producción (Vercel)**: cada invocación de Inngest tiene un límite de **5 minutos** (300s). Si un step procesa un mes entero y tarda más, Vercel devuelve `FUNCTION_INVOCATION_TIMEOUT`. Por eso en `datamapping-full-history` cada mes se subdivide en **rangos de 7 días** (un step por rango); así cada step queda por debajo del límite y los meses más pesados completan sin timeout.

### 3. Ejecución en paralelo

- Lanzar todos los steps de la misma “fase” con `Promise.all` (o equivalente): p. ej. los 26 `step.run('extraer-mes-YYYY-MM', ...)` en paralelo.
- En Inngest Dev Server → Runs se ven las barras de los steps solapadas en el tiempo, confirmando paralelismo.

### 4. Capturar éxitos y fallos: Promise.allSettled

- Usar `Promise.allSettled` (no `Promise.all`) para no fallar todo el run si un step falla tras todos los reintentos.
- Así se obtiene para cada unidad: `fulfilled` → resultado (inserted, updated, etc.) o `rejected` → error.
- Construir con eso:
  - **completedUnits**: listado de unidades que terminaron bien (en el primer intento o tras reintento).
  - **failedUnits**: listado `{ id, error }` de unidades que fallaron tras todos los reintentos → para re-ejecutar o investigar.
  - **byUnit**: mapa unidad → `{ status, ... }` (completed con datos o failed con error).
  - **summary**: texto tipo “26 meses ok” o “24 meses ok, 2 fallaron tras reintentos”.

### 5. Resultado en Convex (pipelineJobs)

- Guardar en `result` del job: `completedUnits`, `failedUnits`, `byUnit`, `summary`, totales (solo de unidades ok).
- Si hay `failedUnits`, marcar el job como `failed` y poner en `errorMessage` un resumen (p. ej. “Meses fallidos (2): 2024-05, 2024-09. Revisar result.failedMonths.”).
- Así en la UI de Jobs se ve el detalle y se sabe en qué unidades enfocarse.

---

## Ejemplo implementado: histórico completo datamapping

- **Función**: `datamapping-full-history` ([src/inngest/datamapping-full-history.ts](../src/inngest/datamapping-full-history.ts)).
- **Unidades**: 26 meses (2024-01 … 2026-02), subdivididos en rangos de 7 días para no superar el timeout de Vercel (5 min por invocación).
- **Steps**: `extraer-2024-01-dias-1-7`, `extraer-2024-01-dias-8-14`, …, uno por rango, en paralelo vía `Promise.all(rangePromises)`.
- **Dentro de cada step**: solo los días del rango (p. ej. 1–7); por cada día, bucle de `fetchDatamappingForDayChunk` hasta `hasMore === false` (chunks para evitar 524/600s). Al final se agregan resultados por mes.
- **Resultado**: `Promise.allSettled` → `completedMonths`, `failedMonths`, `byMonth`, `summary`; se persiste en `pipelineJobs.result` y, si hay fallos, en `errorMessage`.
- **Runbook**: [datamapping-full-history-runbook.md](datamapping-full-history-runbook.md).
- **Rendimiento**: carga completa (todos los meses, con enriquecimiento en la carga) en ~20 minutos en entorno dev; ver runbook sección "Rendimiento observado".

---

## Aplicación a otros pipelines

| Pipeline              | Unidad de trabajo   | Cómo aplicar el patrón                                                                 |
|-----------------------|---------------------|-----------------------------------------------------------------------------------------|
| **Enriquecimiento RFC** | Por mes             | Implementado: `datamapping-enrichment-by-months` (un step por mes, paralelo; bucle con `continueState` dentro del step). Resultado: completedMonths, failedMonths, byMonth. |
| **Agregaciones**      | Un mes              | Un step por mes; paralelo; resultado con completedMonths, failedMonths.               |
| **Reconciliación**    | Un mes o período    | Un step por mes; paralelo; resultado con completedMonths, failedMonths.                |
| **Sync CloudWatch**   | Un día              | Un step por día (o por rango acotado); paralelo si se desea; mismo esquema de resultado.|

En todos los casos: estado y resultado en `pipelineJobs`, y en Inngest Runs se ve qué step falló y en qué attempt pasó (o siguió fallando).

---

## Inngest Dev Server: qué ver

- **Runs** → un run de la función muestra una barra larga y debajo **todos los steps** (`extraer-mes-YYYY-MM`, etc.).
- Steps en **paralelo**: varias barras verdes solapadas en el tiempo.
- **Reintentos**: al expandir un step que falló al inicio, se ven “Attempt 0” (rojo), “Attempt 1” (rojo o verde), “Attempt 2” (verde si el reintento lo solucionó). Así se distingue “completado tras reintento” de “falló tras todos los reintentos”.
- **actualizar-watermark-y-completar** (o equivalente): step final que escribe resultado en Convex; solo corre cuando todos los steps anteriores terminaron (con éxito o rechazo tras reintentos, gracias a `allSettled`).

---

## Resumen

- **Un step por unidad** (mes, día, chunk) → reintentos granulares y visibilidad en Inngest.
- **Chunks dentro del step** → evitar timeouts 524/600s en operaciones grandes.
- **Promise.all** para steps de la misma fase → paralelismo.
- **Promise.allSettled** + resultado con **completedUnits** y **failedUnits** → saber qué terminó bien y en qué enfocarse si algo falla.

Este es el patrón de referencia para cargas masivas y para extenderlo a enriquecimientos, reconciliaciones y agregaciones.
