# Agregaciones DataMapping

Permite visualizar **Análisis Mensual** y **Análisis Anual** usando exclusivamente datos de `datamappingRecords` (DynamoDB), sin depender de CloudWatch. Las tablas agregadas se generan desde datamapping y se mantienen separadas de las de CloudWatch, sin impacto en el flujo existente.

## Resumen

| Aspecto | CloudWatch | DataMapping |
|---------|------------|-------------|
| Origen | `paymentRecords` (logs Step Functions) | `datamappingRecords` (DynamoDB PAGO VALIDADO) |
| Fecha de referencia | `timestamp` / `fechaTransaccion` | `updatedAt` (día y hora exacta) |
| Movimiento | `movimiento` | `tipoMovimiento` |
| Canales | v1, v2, payment | `fuente`: EVO = Tarjeta de Crédito; DEC y otros = Transferencia |

### Mapeo de fuente (DataMapping)

| `fuente` | Canal | Descripción |
|----------|-------|-------------|
| EVO | EVO · Tarjeta de Crédito | Pago con tarjeta |
| DEC | Transferencia · Depósito en Caja | Depósito en caja (transferencia) |
| Otros / vacío | Transferencia | Se agrupan como Transferencia |

## Arquitectura

```
datamappingRecords (Convex)
        │
        ▼
buildDatamappingAggregates (action)
        │
        ├── rawHourlyDataDatamapping
        ├── dailyDataDatamapping
        ├── monthlyDataDatamapping
        ├── hourlyDistributionDatamapping
        ├── dailyAmountDataDatamapping
        └── amountByMovementDatamapping
        │
        ▼
januaryQueriesDatamapping / annualQueriesDatamapping
        │
        ▼
Análisis Mensual / Análisis Anual (?source=datamapping)
```

## Uso

### 1. Cargar datos desde DynamoDB

En **Datos** (`/upload`), sección "Carga desde DynamoDB":

- Configurar fecha inicial (updatedAt posterior a).
- Ejecutar "Cargar desde DynamoDB" o "Extraer todo enero 2026 por día".
- Los registros se guardan en `datamappingRecords`.

### 2. Generar agregaciones

En la misma sección, subsección "Agregaciones DataMapping":

- Seleccionar los meses a procesar (p. ej. 2024-01, 2025-01, 2026-01).
- Clic en "Generar tablas agregadas (DataMapping)".
- La action `buildDatamappingAggregates` lee `datamappingRecords`, agrupa por día/hora exacta de `updatedAt` y escribe en las tablas `*Datamapping`.

### 3. Ver los dashboards con fuente DataMapping

En **Análisis Mensual** (`/`) o **Análisis Anual** (`/anual`):

- Usar el selector CloudWatch / DataMapping en el header.
- Al elegir "DataMapping", las queries leen de las tablas `*Datamapping`.
- La URL admite `?source=datamapping` para compartir o marcar.

## Archivos

| Archivo | Función |
|---------|---------|
| `convex/schema.ts` | Tablas `*Datamapping`, `datamappingDailySourceBreakdown` |
| `convex/datamappingMutations.ts` | Inserts y `clearDatamappingAggregatesForMonth` |
| `convex/datamappingETL.ts` | Action `buildDatamappingAggregates` |
| `convex/queries.ts` | `getDatamappingRecordsByMonthPaginated` |
| `convex/lib/mexicoDate.ts` | `datamappingUpdatedAtToParts` (día/hora exacta) |
| `convex/januaryQueriesDatamapping.ts` | Queries Análisis Mensual para DataMapping |
| `convex/annualQueriesDatamapping.ts` | Queries Análisis Anual para DataMapping |
| `src/app/DashboardContent.tsx` | Selector de fuente y queries dinámicas |
| `src/app/anual/AnnualDashboard.tsx` | Selector de fuente para Análisis Anual |
| `src/app/upload/page.tsx` | UI para generar agregaciones DataMapping |
| `src/components/january/MonthYearSelector.tsx` | `dataSource` para meses disponibles |

## Consideraciones

1. **PaymentChannelsSection**: En DataMapping se muestra EVO (Tarjeta de Crédito) vs Transferencia (Depósito en Caja) usando el campo `fuente`: EVO, DEC y otros.

2. **analysisNotes**: Se comparten entre CloudWatch y DataMapping; no dependen de la fuente.

3. **Meses disponibles**: Con DataMapping, el selector de mes usa `monthlyDataDatamapping`; solo se listan meses para los que se generaron agregaciones.

4. **Deduplicación**: Se cuentan todos los registros de datamapping; cada fila PAGO VALIDADO representa un pago. No hay deduplicación por referencia.

5. **Límite de tiempo**: `buildDatamappingAggregates` tiene un límite de ~550 s; para meses muy grandes puede ser necesario procesar por lotes.
