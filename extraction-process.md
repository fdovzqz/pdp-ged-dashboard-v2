# Proceso de extracción de datos desde CloudWatch

Este documento describe el flujo completo de extracción, transformación e ingesta de pagos desde AWS CloudWatch Logs hacia Convex.

## Visión general

El sistema extrae registros de pago de **3 fuentes** en CloudWatch Logs, los deduplica por referencia, normaliza los campos y los almacena en Convex (`paymentRecords`). La extracción se ejecuta **por día** (fecha en hora México), uno a la vez, desde la UI o mediante la action `fetchAndIngestForDate`.

```
CloudWatch (V1, V2, Payment) → Consulta Logs Insights → Parse → Deduplicación → Convex
```

---

## Fuentes de datos

| Fuente | Log Group (env) | Descripción |
|--------|-----------------|-------------|
| **V1** | `CLOUDWATCH_LOG_GROUP_V1` | ReconciliationProcessAndConfirmationStateMachineLogs (legacy) |
| **V2** | `CLOUDWATCH_LOG_GROUP_V2` | ReconciliationProcessAndConfirmationStateMachineV2Logs (producción) |
| **Payment** | `CLOUDWATCH_LOG_GROUP_PAYMENT` | PaymentProcessStateMachineLogs (EVO/tarjetas de crédito) |

---

## 1. Rango de tiempo (zona horaria México)

- Los registros se filtran por **día local México** (UTC-6).
- Para una fecha `YYYY-MM-DD`:
  - **Inicio**: 00:00 México = 06:00 UTC del mismo día
  - **Fin**: 23:59:59.999 México = 05:59:59.999 UTC del día siguiente

```ts
// convex/actions.ts (simplificado)
const [y, mo, day] = date.split("-").map(Number);
const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
```

- Utilidades: `convex/lib/mexicoDate.ts` (`timestampToMexicoDate`, etc.)

---

## 2. Queries CloudWatch por fuente

### V1 y V2

- **Filtro**: `TaskStateExited` + `Preparar Datos` + `output != null` (solo pagos donde el trámite fue encontrado en la DB)
- **Estructura**: `@message` con JSON anidado (`details.input` o `details.parameters`)

```
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit 10000
```

- Cada registro puede contener:
  - `details.input`: JSON con `transacciones[]` o un solo objeto con `referencia`, `importeTxn`, etc.
  - `details.parameters`: JSON con `Payload.referencia`

### Payment (EVO/TC)

- **Filtro**: `details.parameters` con `status` = "PAGO VALIDADO"
- **Parse**: Extrae campos con `parse` en CloudWatch

```
fields @timestamp, @message, @logStream, @log
| filter details.parameters like /./
| parse details.parameters '"status":"*"' as status
| parse details.parameters '"tramite":"*"' as tramite
| parse details.parameters '"referencia":"*"' as referencia
| parse details.parameters '"total_pagar":"*"' as monto
| parse details.parameters '"movimiento":"*"' as movimiento
| parse details.parameters '"tipo":"*"' as tipo
| filter status like /PAGO VALIDADO/
| sort @timestamp desc
| limit 10000
```

---

## 3. Parsing (convex/lib/parsers.ts)

### V1/V2: `parseV1V2`

- Lee `@message` como JSON.
- Extrae `details.input`, `details.output` (TaskStateExited) o `details.parameters.Payload`.
- Si el output tiene estructura distinta, se usa fallback por regex para extraer `referencia` del string (evitar perder referencias válidas).
- Cada transacción proporciona: `referencia`, `importeTxn`, `fechaTransaccion`, `movimiento`, `estatus`, `tramiteId`.
- Estatus `PA`, `PAGADO`, `PAGO VALIDADO` se normalizan a `PAGO VALIDADO`.
- **`importDate` / `importMonth`**: se prefiere **fecha de la transacción** (`fechaTransaccion`) cuando existe, para asignar al día correcto aunque el workflow haya corrido después; si no hay fecha transacción, se usa `@timestamp` en hora México.

### Payment: `parsePayment`

- Usa campos parseados por CloudWatch (`referencia`, `monto`, `movimiento`, etc.) o fallback a `@message` / `details.parameters`.
- Estatus fijo: `PAGO VALIDADO`.

---

## 4. Deduplicación

Cuando una misma **referencia** aparece en varias fuentes, se conserva una sola con prioridad:

| Prioridad | Fuente | Criterio |
|-----------|--------|----------|
| 1 (alta)  | Payment | Solo PAGO VALIDADO (filtro en query) |
| 2         | V2     | Solo exitosos (TaskStateExited, output != null) |
| 3 (baja)  | V1     | Solo exitosos (TaskStateExited, output != null) |

```ts
const order = { payment: 0, v2: 1, v1: 2 };
// Si está en Payment = PAGO VALIDADO; si está en V1/V2 = trámite encontrado en DB
```

---

## 5. Borrado previo e ingesta

Antes de insertar:

1. **Borrar por `importDate`**: `deletePaymentsByDate` en lotes (límite 4096 lecturas/mutación).
2. **Borrar por referencias**: `deletePaymentsByReferencias` en lotes de 500.

Luego:

- **Insertar**: `ingestPaymentBatch` en lotes de 100.
- Si ya existe la referencia, se omite (`skipped`).

---

## 6. Estadísticas del día

Tras la ingesta, se actualiza `monthStats` con `updateMonthStatsFromDay`:

- Totales por fuente (v1, v2, payment).
- Desglose por movimiento (normalizado con códigos y aliases).
- KPIs: `count`, `monto`, `v1`, `v2`, `payment`, etc.

---

## 7. Flujo en la UI

1. Usuario selecciona rango de fechas (desde/hasta).
2. Clic en **Sincronizar Período** → abre `SyncDialog`.
3. Clic en **Iniciar sincronización** → se itera día a día:
   - Por cada día se llama `fetchAndIngestForDate({ date })`.
4. El progreso se muestra en el diálogo (fecha actual, X de N).
5. Al terminar: resultados (insertados, eliminados) o errores (días fallidos, límite 600s).

**Nota**: Cada día corre en una action Convex separada (límite 600s por acción). Si un día falla, los demás continúan.

---

## 8. Persistencia de sincronización interrumpida

Si el usuario recarga o cierra la pestaña durante la sincronización:

- Se guarda en `localStorage` la clave `reconciliation-sync-in-progress`.
- Al volver a cargar la página, se detecta y se abre el diálogo con un mensaje de sincronización interrumpida.

---

## 9. Límites y consideraciones

| Límite | Valor |
|--------|-------|
| Convex action | 600 s por ejecución |
| Convex mutations | 4096 lecturas/mutación |
| CloudWatch query | 10000 registros por query |
| Polling GetQueryResults | 90 intentos × 1 s ≈ 90 s timeout |

- Las 3 fuentes se consultan **en paralelo** dentro de la misma action para optimizar tiempo.
- Los montos están en **pesos** (no centavos).

---

## 10. Recarga de datos tras cambio de query

Si se cambió la query de extracción (p. ej. de TaskStateEntered a TaskStateExited), es necesario recargar todos los datos:

```bash
# Recargar rango de meses (ejemplo: 2024-01 a 2026-02)
npx tsx scripts/reload-all-months.ts 2024-01 2026-02

# O desde la UI: página /upload, seleccionar rango de fechas, Sincronizar Período
```

---

## 11. Archivos relevantes

| Archivo | Rol |
|---------|-----|
| `convex/actions.ts` | `fetchAndIngestForDate`, `fetchCloudWatch` |
| `convex/lib/parsers.ts` | `parseV1V2`, `parsePayment` |
| `convex/lib/mexicoDate.ts` | Conversión UTC → México |
| `convex/mutations.ts` | `ingestPaymentBatch`, `deletePaymentsByDate`, `deletePaymentsByReferencias`, `updateMonthStatsFromDay` |
| `src/app/upload/page.tsx` | UI, `handleStartSync`, estado de sincronización |
| `src/components/dashboard/SyncDialog.tsx` | Diálogo de sincronización |
| `scripts/reload-all-months.ts` | Script para recargar meses tras cambio de query |

---

## Referencias

- [cloudwatch-queries.md](cloudwatch-queries.md) – Queries CloudWatch para análisis manual
- [README.md](README.md) – Configuración e inicio rápido
