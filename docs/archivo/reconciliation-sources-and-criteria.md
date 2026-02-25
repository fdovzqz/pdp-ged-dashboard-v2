# Fuentes de datos y criterios para reconciliación

Este documento define el **conjunto comparable** y el **criterio de mes** usados para comparar las dos fuentes (CloudWatch → paymentRecords, DynamoDB → datamappingRecords) y para las estadísticas de "registros cargados".

---

## Las dos fuentes

| Fuente | Tabla Convex | Origen | Clave única |
|--------|--------------|--------|-------------|
| CloudWatch | `paymentRecords` | Logs CloudWatch (v1, v2, payment) | Dedup por `referencia` (prioridad payment > v2 > v1) |
| Datamapping | `datamappingRecords` | DynamoDB | Upsert por `transactionId` |

---

## Conjunto comparable (qué se compara en reconciliación)

Para que la comparación por referencia sea coherente, en cada fuente se considera un subconjunto explícito:

- **CloudWatch (paymentRecords):** Todos los registros en la tabla. Ya están deduplicados por referencia (un registro por referencia, el de mayor prioridad: payment > v2 > v1) y filtrados en origen por estado tipo "PAGO VALIDADO" en la query de logs.
- **Datamapping (datamappingRecords):** Solo registros con `status === "PAGO VALIDADO"`. Este filtro se aplica en las queries y en la action `runReconciliation`; la ingestión desde DynamoDB no filtra por status (se guarda todo y se filtra al leer).

Resumen: **CW = paymentRecords (dedup por ref); DDB = datamappingRecords con status PAGO VALIDADO.**

---

## Criterio de "mes"

### Stats de "registros cargados" (conteos en UI)

- **CloudWatch:** Por **fecha de importación**: `importMonth` / `importDate` (cuándo se cargó el registro).
- **Datamapping:** Por **fecha de actualización**: `updatedAt` (cuándo se insertó/actualizó en Convex). Las estadísticas por mes (`datamappingMonthStats`) se basan en `updatedAt` para reflejar qué se cargó y cuándo.

Opcionalmente se puede añadir en el futuro una variante "por mes transaccional" para datamapping (usando `fechaTransaccionMexico`) si el negocio lo requiere.

### Reconciliación (comparación de referencias)

Hay dos opciones documentadas:

- **Opción 1 (actual):** Mes = `importMonth` en CW. En DDB se usa el rango de `updatedAt` correspondiente a ese mes (UTC) vía `monthToUtcRange(month)`. No es estrictamente "mes transaccional" en DDB.
- **Opción 2 (mes transaccional):** En DDB usar `fechaTransaccionMexico` para asignar el mes y comparar "mismo mes transaccional". Requiere que `fechaTransaccionMexico` esté poblado (backfill existente). La UI de alcance (mes/periodo) se interpretaría como mes transaccional en ambas fuentes.

La implementación actual usa la **Opción 1** por defecto. Para usar la **Opción 2** (mes transaccional en DDB), la action `runReconciliation` acepta el argumento opcional `useTransactionMonthForDdb: true`. Cuando es true y el scope es "month" o "period", se usa el rango de `fechaTransaccionMexico` (YYYY-MM-DD) para datamappingRecords en lugar de `updatedAt`.

---

## Estadísticas por mes (UI "Registros cargados")

La sección **Registros cargados** (Configuración → Carga de fuentes) muestra ambas fuentes en formato espejo: mismas columnas (totales, por año, por mes, diferencia por día).

- **Tablas Convex:** CloudWatch usa `monthStats` (una fila por mes, con `ingestionStatus.byDate`). Datamapping usa `datamappingMonthStats` (una fila por mes, mismo shape: totalRecords, daysWithData, byDate) y opcionalmente `datamappingIngestionStats` (totales globales).
- **Contrato en frontend:** Tipo `SourceMonthStats`: `{ month, totalRecords, daysWithData, lastUpdated }`. El detalle por día del mes seleccionado usa `SourceMonthDetail`: `{ totalRecords, daysWithData, byDate }`. Ambas fuentes se mapean a ese contrato; totales, por año y por mes se derivan de la misma forma.
- **Recálculo:** "Recalcular paymentRecords" regenera `monthStats` desde paymentRecords. "Recalcular datamappingRecords" ejecuta la action que recalcula `datamappingIngestionStats` y `datamappingMonthStats` desde datamappingRecords.

---

## Resumen

- **Conjunto comparable:** CW = paymentRecords; DDB = datamappingRecords con status PAGO VALIDADO.
- **Stats de carga:** Por fecha de ingestión (importMonth/importDate en CW, updatedAt en DDB). Tablas: monthStats (CW), datamappingMonthStats + datamappingIngestionStats (DDB).
- **Reconciliación:** Criterio de mes documentado como Opción 1 (updatedAt para DDB) u Opción 2 (fechaTransaccionMexico para DDB); en código: `runReconciliation(..., useTransactionMonthForDdb: true)` para Opción 2.
