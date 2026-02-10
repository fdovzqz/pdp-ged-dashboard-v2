# Queries de CloudWatch Logs Insights

Queries para analizar pagos de los workflows de reconciliación y procesamiento de pagos.

> **Proceso de extracción automatizado**: El sistema usa queries específicas en `convex/actions.ts` para la sincronización. Ver [extraction-process.md](extraction-process.md) para el flujo completo.

## Log Groups

- **V1 (legacy)**: `/aws/vendedlogs/states/ReconciliationProcessAndConfirmationStateMachineLogs/master`
- **V2 (producción)**: `/aws/vendedlogs/states/ReconciliationProcessAndConfirmationStateMachineV2Logs/master`
- **EVO/TC (PaymentProcess)**: `/aws/vendedlogs/states/PaymentProcessStateMachineLogs/master`

---

## 1. Pagos Exitosos por Día

Cuenta solo pagos donde el trámite fue encontrado en la DB (output ≠ null).

```
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\d+)/
| stats count(*) as totalRegistros, sum(importeTxn) as montoTotal by datefloor(@timestamp - 21600000, 24h) + 21600000 as fecha
| sort fecha asc
```

---

## 2. Desglose por Tipo de Trámite

```
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /movimiento[^A-Z]+(?<movimiento>[A-Z]+)/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\d+)/
| stats count(*) as total, sum(importeTxn) as monto by movimiento
| sort total desc
```

---

## 3. Comparación: Recibidos vs Exitosos

Muestra cuántos pagos entran al workflow vs cuántos se procesan exitosamente.

```
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| stats 
    count(*) as total,
    sum(strcontains(@message, '"output":"null"')) as noEncontrados,
    sum(strcontains(@message, '"output":"{\\"')) as encontrados
```

---

## 4. Todos los Pagos Recibidos (incluye no exitosos)

```
fields @timestamp, @message
| filter @message like /TaskStateEntered/ and @message like /Preparar Datos/
| filter @message like /referencia/ and @message like /PAGADO/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\d+)/
| stats count(*) as totalRegistros, sum(importeTxn) as montoTotal by datefloor(@timestamp - 21600000, 24h) + 21600000 as fecha
| sort fecha asc
```

---

## 5. Detalle de Transacciones (primeras 50)

```
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /referencia[^0-9]+(?<referencia>\d+)/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\d+)/
| parse @message /tramiteId[^0-9]+(?<tramiteId>\d+)/
| parse @message /movimiento[^A-Z]+(?<movimiento>[A-Z]+)/
| display @timestamp, referencia, importeTxn, tramiteId, movimiento
| sort @timestamp desc
| limit 50
```

---

## 6. Buscar por Referencia Específica

```
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message like /REFERENCIA_AQUI/
| sort @timestamp desc
| limit 10
```

---

## 7. Pagos por Hora (para análisis de picos)

```
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\d+)/
| stats count(*) as pagos, sum(importeTxn) as monto by datefloor(@timestamp - 21600000, 1h) + 21600000 as hora
| sort hora asc
```

---

## 8. PaymentProcess (EVO/TC) - Pagos con PAGO VALIDADO

Query usada por el sistema de reconciliación para EVO (tarjetas de crédito).

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

## 9. Eventos MapStateExited (array exitosos)

```
fields @timestamp, @message
| filter @message like /MapStateExited/ and @message like /"name":"Procesar Pagos"/
| sort @timestamp desc
| limit 20
```

---

## Notas Importantes

### Timezone - Hora México (UTC-6)
- Todas las consultas usan rangos UTC equivalentes al día local México
- **00:00 México** = 06:00 UTC del mismo día
- **23:59:59.999 México** = 05:59:59.999 UTC del día siguiente
- Utilidades: `src/lib/mexicoDateRange.ts`, `convex/lib/mexicoDate.ts`

### Filtro de Exitosos
- `TaskStateExited` + `not like /"output":"null"/`
- Solo cuenta pagos donde el trámite existe en la base de datos

### Parse de importeTxn
- Patrón `[^0-9]+` captura cualquier separador (funciona con JSON escapado)
- Los valores están en **pesos** (no centavos)

### Deduplicación
- Prioridad entre fuentes: **Payment > V2 > V1**
- Cuando una referencia aparece en varias fuentes, se conserva la de mayor prioridad
