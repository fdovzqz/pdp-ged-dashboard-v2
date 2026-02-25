# Propuesta de corrección y plan de rollout

## Resumen de causas identificadas

| Causa | Tipo | Mitigación |
|-------|------|------------|
| **Truncamiento** | Límite 10k por query CloudWatch Logs Insights | Ventanas (ya 2/día → hasta 20k); opcional 4 ventanas o detección de saturación |
| **Parseo V2/SPEI** | Estructura input/output null o no estándar no extraía referencia | Fallback en parser: extraer referencia del mensaje crudo con regex |
| **Semántica last-write-wins** | Una ref en varios meses solo cuenta en uno en Convex | Documentar; opcional materialización histórica por mes para reportes |

---

## 1. Truncamiento (límite 10k por ventana)

**Estado actual:** `fetchCloudWatchWithWindows` divide el día en 2 ventanas (mitad cada una), permitiendo hasta ~20k eventos por fuente por día.

**Riesgo:** Días con >10k eventos en una mitad del día en una sola fuente siguen truncados.

**Opciones:**

- **A) Ventanas adaptativas:** Si tras las 2 ventanas alguna fuente devuelve ≥10k filas en una ventana, re-ejecutar ese día con 4 ventanas (cuartos de día). Requiere detectar “saturación” (p. ej. `rawBySource[source] >= 10000` en la auditoría) y reprocesar o lanzar un job correctivo.
- **B) Siempre 4 ventanas:** Dividir el día en 4 segmentos (6h) para soportar hasta ~40k eventos por fuente por día. Aumenta llamadas a CloudWatch y tiempo de sync.
- **C) Alerta sin reproceso:** Usar `cloudwatchIngestionAudit.truncationRisk` para marcar días con riesgo y notificar; reproceso manual bajo demanda.

**Recomendación:** Mantener 2 ventanas; usar `truncationRisk` en auditoría y en UI para marcar días con posible truncamiento. Si se confirman días con >10k en una ventana, implementar (A) o (B) en una segunda fase.

---

## 2. Parseo V2/SPEI (referencia no extraída)

**Problema:** Referencias sentinela (SPEI) aparecen en CloudWatch pero no en Convex. El parser dependía de `details.input` / `details.output` estructurados; cuando son `null` o con formato no contemplado, no se extraía la referencia.

**Cambio realizado:** En `convex/lib/parsers.ts`, en `parseV1V2`, se añadió un **fallback** que, cuando `items.length === 0` tras intentar input/output/parameters, extrae del mensaje crudo (`@message`):

- `referencia` con regex `"referencia"\s*:\s*"(\d{15,})"` (y variante escapada)
- opcionalmente `importeTxn` y `fechaTransaccion` si aparecen en el mensaje

Así se cubren eventos V2/SPEI donde la referencia solo está en el cuerpo del log.

**Rollout:**

1. Desplegar el cambio de parser (ya aplicado en código).
2. Re-ejecutar sync CloudWatch por rango para febrero 2026 (o al menos 1–22) para re-ingestar con el parser nuevo.
3. Ejecutar de nuevo `scripts/trace-sentinel-referencias.ts` y comprobar que las 5 referencias sentinela aparecen en Convex con `importMonth` 2026-02.

---

## 3. Semántica mensual (last-write-wins)

**Comportamiento:** Convex guarda una fila por referencia; la última escritura determina `importMonth`/`importDate`. Si una referencia tiene eventos en febrero y marzo, según el orden de sincronización puede quedar solo en un mes.

**Opciones:**

- **Documentar:** Dejar claro en negocio y en docs que “conteo por mes” en Convex = “referencias cuyo estado actual tiene ese importMonth”, no “referencias con al menos un evento en ese mes”.
- **Materialización histórica (futuro):** Tabla o vista que guarde, por referencia y mes, “¿hubo al menos un evento en este mes?” (p. ej. desde CloudWatch o desde un ETL que no sobrescriba). Permite reportes “por mes de evento” sin cambiar el modelo actual.

**Recomendación:** Documentar (ya en `docs/audit/validacion-semantica-mensual.md`). Materialización histórica solo si negocio exige conteos “por mes de evento” de forma explícita.

---

## Plan de rollout sugerido

| Fase | Acción | Responsable |
|------|--------|--------------|
| **Inmediato** | Parser: fallback referencia desde mensaje crudo (implementado) | Dev |
| **Inmediato** | Re-sincronizar rango feb 2026 (1–22) y verificar 5 refs sentinela en Convex | Ops/Dev |
| **Corto** | Revisar en UI/API si mostrar `truncationRisk` por día (desde `cloudwatchIngestionAudit`) | Dev |
| **Medio** | Si se confirman días con truncamiento: ventanas adaptativas (4) o alerta + reproceso manual | Dev |
| **Opcional** | Si negocio lo pide: diseño de materialización “evento por mes” para reportes | Producto/Dev |

---

## Criterios de éxito

- Las 5 referencias sentinela (SPEI) aparecen en `paymentRecords` con `importMonth` 2026-02 tras re-sync.
- Los números de `monthStats` para 2026-02 son reproducibles con el baseline (script de auditoría) dentro de la brecha explicada por last-write-wins.
- Días con riesgo de truncamiento identificables vía `cloudwatchIngestionAudit` (y opcionalmente en UI).
