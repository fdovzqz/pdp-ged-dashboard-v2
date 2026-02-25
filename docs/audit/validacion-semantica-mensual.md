# Validación: diferencia por definición de mes vs diferencia por bug real

## Objetivo

Separar la brecha de conteos CloudWatch vs Convex en dos componentes:

1. **Diferencia por definición (semántica mensual)**  
   Convex guarda **una sola fila por referencia** (last-write-wins). Si la misma referencia aparece en logs de febrero y de otro mes (ej. marzo), al sincronizar ese otro mes la fila se actualiza y la referencia pasa a `importMonth` del mes que se procesó al final. Por tanto:
   - **Convex (monthStats)** = referencias que *hoy* tienen `importMonth` = ese mes.
   - **CloudWatch (criterio B)** = referencias que tienen *al menos un evento* con fecha de transacción en ese mes.

   Así, una referencia con evento en feb y otro en mar puede contar en CloudWatch en febrero pero en Convex figurar solo en marzo.

2. **Diferencia por bug real (pérdida en ingestión)**  
   Referencias que sí aparecen en CloudWatch (con `importDate` en el rango) pero **nunca llegaron a Convex** o llegaron con otro mes por truncamiento, fallo de parseo o ventana de query (límite 10k/20k).

## Métricas del baseline (2026-01-01 .. 2026-02-22)

| Métrica | Descripción | Valor |
|--------|-------------|--------|
| **A** | Eventos raw CloudWatch (por timestamp de log) | 86.110 |
| **B** | Referencias únicas por fecha transacción en rango (CloudWatch parseado + dedup) | 84.341 |
| **C (Enero)** | Convex monthStats 2026-01 | 69.539 |
| **C (Febrero)** | Convex monthStats 2026-02 | 8.826 |
| **C (Enero + Febrero)** | Total registros con importMonth en el rango | 78.365 |

## Desglose de la brecha

- **B − (C_ene + C_feb) = 84.341 − 78.365 = 5.976** referencias “de más” en CloudWatch respecto a lo que Convex muestra en enero y febrero.

Esa brecha se reparte en:

1. **Por definición (last-write-wins)**  
   Referencias que en CloudWatch tienen al menos un evento con `importDate` en ene/feb, pero en Convex tienen `importMonth` **fuera** de ene/feb (ej. 2026-03 o 2025-12) porque una sincronización posterior (de otro mes) sobrescribió la fila.  
   - No es un bug: es la semántica “una fila global por referencia”.

2. **Por bug real**  
   Referencias que en CloudWatch tienen evento en el rango pero en Convex **no existen** o no tienen ese mes por:
   - Truncamiento del query (límite 10k/20k por ventana).
   - Parseo que no extrae la referencia (formato V2/SPEI, etc.).
   - Ventana de fechas o orden de ejecución que dejó fuera el día/fuente.

## Evidencia de pérdida real: referencias sentinela (5 SPEI)

El script `scripts/trace-sentinel-referencias.ts` trazó cinco referencias conocidas (SPEI, V2):

| Referencia | En CloudWatch | Dedup winner | importDate (CW) | En Convex |
|------------|----------------|--------------|------------------|-----------|
| 202600002323148754268 | Sí (v2) | v2 | 2026-02-03 | No |
| 202600002968248834274 | Sí (v2) | v2 | 2026-02-13 | No |
| 202600002823548839291 | Sí (v2) | v2 | 2026-02-12 | No |
| 202600002547848836231 | Sí (v2) | v2 | 2026-02-10 | No |
| 202600002531048837213 | Sí (v2) | v2 | 2026-02-10 | No |

**Conclusión:** Las cinco están en CloudWatch (V2) con `importDate` en febrero 2026 y **no aparecen en Convex**. Eso demuestra **pérdida real** en la ingestión (no solo diferencia por definición).

Causas probables para estas refs:

- **Truncamiento:** En días con mucho volumen (ej. 2026-02-16 con 6.659 eventos V2 en el baseline), una sola ventana de 10k puede no devolver todos los eventos; si la ventana de 12h no alcanza o el orden hace que queden fuera, se pierden.
- **Parseo:** El parser Convex (`parseV1V2` en `lib/parsers.ts`) podría no estar extrayendo referencias de todos los formatos V2 (p. ej. SPEI con `output` null o estructura distinta). El script de trazabilidad usa un parse por regex sobre el mensaje crudo y sí las encuentra.

## Resumen

| Tipo de diferencia | Descripción | Evidencia |
|--------------------|-------------|-----------|
| **Por definición** | Una ref con eventos en varios meses solo cuenta en un mes en Convex (last-write-wins). | Brecha B − (C_ene + C_feb) incluye refs que en Convex tienen importMonth fuera de ene/feb. |
| **Por bug real** | Refs en CloudWatch con importDate en el rango que no están en Convex. | 5 refs sentinela (SPEI) en CW con importDate feb 2026 y 0 en Convex. Instrumentación por día (raw/parsed/dedup/truncationRisk) permite cuantificar más. |

Para cuantificar la parte “por definición” habría que cruzar refs de CloudWatch (criterio B) con `paymentRecords` y ver cuántas tienen `importMonth` fuera de ene/feb. Para la parte “por bug”, la auditoría por día (`cloudwatchIngestionAudit`) y las refs sentinela dan ya una cota inferior (al menos 5 refs perdidas en feb 2026).
