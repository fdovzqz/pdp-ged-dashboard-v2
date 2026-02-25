# Runbook: backfill determinístico CloudWatch (Ene 2024 – hoy)

## Objetivo
Obtener una copia fiel de los 3 logs de CloudWatch (v1, v2, payment) desde 2024-01-01 hasta la fecha, usando el proceso determinístico (conteo por hora, extracción por intervalos, verificación) y luego consolidar en `paymentRecords`.

## Pasos

### 1. Lanzar sync determinístico por meses
- **Endpoint:** `POST /api/cloudwatch/sync-by-months`
- **Body (ejemplo):**
  ```json
  {
    "deterministic": true,
    "start": "2024-01",
    "end": "2026-02"
  }
  ```
  O con fechas exactas:
  ```json
  {
    "deterministic": true,
    "startDate": "2024-01-01",
    "endDate": "2026-02-24"
  }
  ```
- **Respuesta:** `{ "ok": true, "jobId": "...", "deterministic": true }`
- El job escribe en `cloudwatchSourceV1`, `cloudwatchSourceV2`, `cloudwatchSourcePayment`. No escribe en `paymentRecords` hasta ejecutar la consolidación.
- Concurrencia: 1 unidad a la vez (evitar throttling AWS).

### 2. Monitorear el job
- En la UI de operaciones (runs), revisar progreso y unidades fallidas.
- Si una unidad falla por verificación (expected ≠ inserted), revisar `result` de la unidad; reintentar con `retryPipelineUnit` o `retryFailedUnits` si aplica.
- Criterio de éxito: 0 unidades fallidas; todas con `counted == inserted` por fuente.

### 3. Ejecutar consolidación
- Cuando el sync determinístico haya completado el rango deseado:
- **Endpoint:** `POST /api/cloudwatch/consolidate`
- **Body:**
  ```json
  {
    "fromDate": "2024-01-01",
    "toDate": "2026-02-24"
  }
  ```
- La consolidación lee las 3 tablas fuente, aplica prioridad (RuleSet dedup: Payment > V2 > V1), y escribe en `paymentRecords` para ese rango.

### 4. Regenerar monthStats (opcional)
- Tras la consolidación, si hace falta actualizar `monthStats` y agregados, usar la acción existente `recreateAllMonthStatsFromPaymentRecords` o el flujo que ya actualiza al finalizar el sync legacy.

## Criterios de aceptación (quality gates)
- 100% de unidades del sync determinístico con `expected === inserted` por fuente (v1, v2, payment).
- 0 unidades en estado `failed` para declarar el backfill exitoso.
- `paymentRecords` en el rango generado únicamente desde la consolidación (no desde el sync legacy).
- Para fechas donde un log no existía (v1/v2 posteriores al Portal): count 0 y sin error.

## Notas
- Fuentes v1 y v2 pueden tener count 0 para meses anteriores a su arranque; es esperado.
- Re-ejecutar un día o mes: idempotente (borrado por `importDate` + recarga por fuente).
