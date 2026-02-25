# Matriz de decision: refactor mayor vs nuevo proyecto

## Opciones evaluadas

- **Opcion A: Refactor mayor evolutivo** sobre base actual Convex.
- **Opcion B: Nuevo proyecto greenfield** con migracion posterior.

## Criterios ponderados

| Criterio | Peso | A Refactor | B Nuevo |
|---|---:|---:|---:|
| Cobertura funcional actual sin regresion | 20 | 4 | 2 |
| Riesgo operativo de transicion | 20 | 4 | 2 |
| Tiempo a valor (fase actual + siguiente) | 15 | 4 | 2 |
| Robustez target (retry, calidad, auditoria) | 15 | 3 | 5 |
| Costo total de implementacion | 10 | 4 | 2 |
| Mantenibilidad a largo plazo | 10 | 3 | 5 |
| Compatibilidad con restricciones Convex/fuentes | 10 | 4 | 3 |
| **Score ponderado total** | **100** | **3.8 / 5** | **2.9 / 5** |

## Recomendacion explicita

**Recomendada: Opcion A (Refactor mayor evolutivo por fases).**

Razon principal:

- Reduce riesgo de interrumpir capacidades ya operativas.
- Permite introducir el engine configurable y evidencia auditiva sin detener entregables.
- Acelera estabilizacion de fases actuales mientras habilita las siguientes.

## Condiciones obligatorias para aprobar la opcion A

1. Definir contratos de reglas/versionado antes de ampliar features.
2. Implementar observabilidad y quality gates como parte del core, no como extras.
3. Ejecutar migracion por fases con criterios de salida por fase.
4. Mantener compatibilidad temporal con flujos actuales hasta cerrar verificacion.

## Riesgos residuales de la opcion A

- Arrastre de deuda tecnica si no se encapsula correctamente.
- Mezcla temporal de modelos viejos/nuevos durante migracion.
- Complejidad de gobernanza de reglas si no se centraliza desde el inicio.

## Mitigaciones

- "Strangler pattern" por etapas del workflow.
- Banderas de activacion por version de workflow.
- Calidad y auditoria obligatorias en cada fase antes de avanzar.

## Criterio de reevaluacion (switch a opcion B)

Si en dos fases consecutivas no se logra:

- cierre confiable de corridas,
- trazabilidad auditiva completa,
- y reduccion de re-runs manuales,

entonces reevaluar y activar plan de nuevo proyecto.
