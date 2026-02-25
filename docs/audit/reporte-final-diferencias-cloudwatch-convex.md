# Reporte final: diferencias CloudWatch vs Convex

**Fecha:** 2026-02-23  
**Alcance:** Revisión de diferencias de conteo entre datos extraídos de CloudWatch (3 fuentes: V1, V2, Payment) y los registros almacenados en Convex para el rango 2026-01-01 a 2026-02-22.

---

## 1. Resumen ejecutivo

La diferencia entre lo que CloudWatch reporta (por evento con fecha en el rango) y lo que Convex muestra (registros con `importMonth` ene/feb) se explica por **dos factores**:

1. **Semántica del modelo (last-write-wins):** Convex guarda **una sola fila por referencia**. Si la misma referencia aparece en varios meses, solo cuenta en el mes de la última escritura. CloudWatch cuenta “eventos con fecha en el mes”. Por eso el conteo “por mes de evento” en CloudWatch puede ser mayor que el conteo “por importMonth” en Convex.
2. **Pérdida real en ingestión:** Algunas referencias que sí están en CloudWatch (con fecha en el rango) **no llegan** a Convex por truncamiento del query (límite 10k por ventana) o porque el parser no extraía la referencia (ej. eventos V2/SPEI con `output` null).

Se implementó **instrumentación** (auditoría por día), **trazabilidad** de referencias sentinela y un **fallback en el parser** para reducir la pérdida por parseo. Se documentan criterios de conteo recomendados para negocio y reconciliación.

---

## 2. Brecha de números (baseline 2026-01-01 .. 2026-02-22)

| Métrica | Descripción | Valor |
|--------|-------------|--------|
| **A – Eventos raw** | Filas devueltas por CloudWatch (por timestamp de log) | 86.110 |
| **B – Ref únicas por fecha transacción** | Referencias distintas con `importDate` en el rango (CloudWatch parseado + dedup) | 84.341 |
| **C – Convex enero** | Registros con `importMonth` = 2026-01 | 69.539 |
| **C – Convex febrero** | Registros con `importMonth` = 2026-02 | 8.826 |
| **C – Total ene+feb** | Registros con importMonth en el rango | 78.365 |

**Brecha:** B − (C_ene + C_feb) = 84.341 − 78.365 = **5.976** referencias que CloudWatch asocia al rango pero que en Convex no aparecen contadas en enero ni febrero.

---

## 3. Causas cuantificadas

### 3.1 Diferencia por definición (last-write-wins)

- Parte de las **5.976** refs corresponden a referencias que en CloudWatch tienen al menos un evento con `importDate` en ene/feb, pero en Convex tienen `importMonth` **fuera** de ese rango (p. ej. 2026-03) porque una sincronización posterior de otro mes sobrescribió la fila.
- No es un fallo del sistema: es la semántica “una fila global por referencia”.
- Para cuantificar exactamente cuántas de las 5.976 son “por definición” haría falta cruzar la lista de refs de CloudWatch (criterio B) con `paymentRecords` y ver cuántas tienen `importMonth` ∉ {2026-01, 2026-02}.

### 3.2 Pérdida real (bug): evidencia con referencias sentinela

- **5 referencias sentinela (SPEI, V2)** fueron trazadas de extremo a extremo:
  - En **CloudWatch** aparecen en el rango feb 2026 (V2), con `importDate` en febrero.
  - En **Convex** no aparecen (no hay fila en `paymentRecords`).
- **Conclusión:** Existe **pérdida real** en la ingestión. Al menos 5 referencias no se incorporaron. Causas probables:
  1. **Parseo:** El parser no extraía la referencia cuando `details.input`/`details.output` son null o tienen estructura no estándar (SPEI). **Mitigación:** fallback en el parser que extrae referencia del mensaje crudo (implementado).
  2. **Truncamiento:** En días con mucho volumen (ej. 2026-02-16 con miles de eventos V2), el límite de 10k por ventana podría haber dejado fuera eventos. La instrumentación (`cloudwatchIngestionAudit`) permite detectar días con `truncationRisk` en futuras corridas.

### 3.3 Instrumentación por etapa (por día)

- Para cada día sincronizado se registra en `cloudwatchIngestionAudit`:
  - **rawBySource:** filas recibidas de CloudWatch por fuente (v1, v2, payment).
  - **parsedBySource:** filas que el parser convirtió en registros por fuente.
  - **refsKeptBySource / refsDiscardedBySource:** efecto de la deduplicación por prioridad (payment > v2 > v1).
  - **deleted / inserted / skipped:** escrituras en Convex.
  - **truncationRisk:** true si alguna fuente tuvo ≥10k filas en una ventana (posible truncamiento).

Con esto se pueden identificar días con posible truncamiento o pérdida en parseo y priorizar reprocesos o ajustes.

---

## 4. Referencias de ejemplo (sentinela)

| Referencia | En CloudWatch | Fuente | importDate (CW) | En Convex |
|------------|----------------|--------|------------------|-----------|
| 202600002323148754268 | Sí | v2 | 2026-02-03 | No |
| 202600002968248834274 | Sí | v2 | 2026-02-13 | No |
| 202600002823548839291 | Sí | v2 | 2026-02-12 | No |
| 202600002547848836231 | Sí | v2 | 2026-02-10 | No |
| 202600002531048837213 | Sí | v2 | 2026-02-10 | No |

Tras aplicar el fallback en el parser y re-sincronizar el rango de febrero 2026, estas referencias deberían aparecer en Convex con `importMonth` 2026-02.

---

## 5. Criterio oficial recomendado para negocio y reconciliación

- **Convex (monthStats / UI):**  
  “Número de referencias cuyo **estado actual** tiene `importMonth` = X.”  
  Equivale a: una referencia cuenta solo en un mes (el de la última escritura).

- **CloudWatch (scripts de auditoría, criterio B):**  
  “Número de referencias que tienen **al menos un evento** con fecha de transacción (importDate) en el mes.”  
  Una misma referencia puede contar en varios meses si tiene eventos en varios meses.

- **Reconciliación:**  
  - Para comparar con fuentes externas “por mes de transacción”, usar el criterio tipo CloudWatch (baseline B) y aceptar que el número de Convex por `importMonth` puede ser menor por last-write-wins.  
  - Para “número de referencias únicas que el sistema considera del mes X”, usar monthStats/Convex.  
  - Para detectar pérdida real: usar referencias sentinela y auditoría por día (`cloudwatchIngestionAudit`, `truncationRisk`).

---

## 6. Entregables y siguientes pasos

| Entregable | Ubicación |
|------------|-----------|
| Baseline A/B/C (por día y fuente) | `scripts/audit-baseline-metrics.ts`; snapshots en `docs/audit/audit-baseline-*.json` |
| Instrumentación por etapa (fetch/parse/dedup/writes) | Tabla `cloudwatchIngestionAudit`; mutación `recordCloudwatchIngestionAudit`; queries `getCloudwatchIngestionAuditByDate`, `listCloudwatchIngestionAudit` |
| Trazabilidad referencias sentinela | `scripts/trace-sentinel-referencias.ts`; output en `docs/audit/trace-sentinel-referencias.json` |
| Validación semántica mes vs evento | `docs/audit/validacion-semantica-mensual.md` |
| Propuesta de corrección y rollout | `docs/audit/propuesta-correccion-y-rollout.md` |
| Fallback parser V2/SPEI | `convex/lib/parsers.ts` (parseV1V2) |

**Siguientes pasos recomendados:**

1. Re-sincronizar CloudWatch para febrero 2026 (1–22) con el parser actualizado y comprobar que las 5 referencias sentinela aparecen en Convex.
2. Revisar en la UI o en reportes los días con `truncationRisk` y, si aplica, planear ventanas adaptativas (4 por día) o reproceso manual.
3. Dejar documentado en operaciones que el “conteo oficial por mes” en la plataforma es por `importMonth` (una ref, un mes) y que los reportes “por evento en el mes” deben usar el script de baseline o un criterio equivalente.
