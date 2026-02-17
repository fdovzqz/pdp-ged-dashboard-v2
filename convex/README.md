# Convex - Reconciliación de Pagos

Funciones Convex para almacenar y consultar pagos de CloudWatch.

## Schema: paymentRecords

| Campo | Tipo | Descripción |
|-------|------|-------------|
| referencia | string | Referencia única del pago |
| monto | number | Monto en pesos |
| timestamp | string | Timestamp CloudWatch (UTC) |
| fechaTransaccion | string | Fecha transacción |
| logSource | v1, v2, payment | Fuente del log |
| movimiento | string | Tipo de trámite (DENOM, Refrendo, etc.) |
| estatus | string | Estatus (PAGADO, PAGO VALIDADO, etc.) |
| tramiteId | number (opc.) | ID trámite |
| importMonth | string | YYYY-MM |
| importDate | string (opc.) | YYYY-MM-DD en hora México (UTC-6) |

## Schema: monthStats (dayEntries / dailyBreakdown)

Cada entrada de día incluye conteos y montos por fuente:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| v1, v2, payment | number | Conteo de transacciones por fuente |
| v1Monto, v2Monto, paymentMonto | number (opc.) | Monto total por fuente (V1, V2, EVO) |

Usados por `getPaymentChannelStats` para desglose EVO vs Ventanilla por día.

## Schema: pipelineJobs

Jobs de pipeline con estado persistido. Ver [docs/jobs-page.md](../docs/jobs-page.md).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| jobType | string | Tipo de job |
| scope | any | Alcance (fechas, meses, etc.) |
| status | enum | pending \| running \| completed \| failed \| cancelled |
| progress | object? | current, total?, unit?, message? |
| result, errorMessage | any? | Resultado o error |
| startedAt, completedAt | number | Timestamps |
| dependsOnJobIds, parentJobId | id[]? | Dependencias |
| externalId, retryCount | string? \| number? | Integración externa |

**pipelineJobs.ts**: createPipelineJob, updatePipelineJobProgress, updatePipelineJobResult, updatePipelineJobError, updatePipelineJobRetry, listPipelineJobs, getPipelineJob.

Las cargas masivas (histórico datamapping, enriquecimientos, agregaciones) orquestadas por Inngest guardan en `result` listas `completedMonths` / `failedMonths` (o equivalentes) para saber qué unidades terminaron bien y cuáles fallaron. Ver [docs/mass-loads-inngest-pattern.md](../docs/mass-loads-inngest-pattern.md).

---

## Funciones

### Actions

- **fetchAndIngestForDate** (date: string) – Consulta CloudWatch para el día (hora México), deduplica (payment > v2 > v1) e inserta en Convex. Borra datos previos de esa fecha antes de insertar.

### Mutations

- **ingestPaymentBatch** – Inserta lote de registros (omite si referencia ya existe).
- **deletePaymentsByMonth** – Borra todos los registros de un mes (YYYY-MM).
- **deletePaymentsByDate** – Borra registros con importDate = date.
- **deletePaymentsByReferencias** – Borra registros con las referencias indicadas (para limpiar datos con importDate incorrecto antes de re-sync).

### Agregaciones DataMapping

Para visualizar Análisis Mensual y Anual con datos exclusivamente de DynamoDB (datamapping):

- **datamappingETL.buildDatamappingAggregates** – Lee `datamappingRecords`, agrupa por mes (updatedAt) y escribe en tablas `*Datamapping`.
- **datamappingMutations** – `batchInsert*Datamapping`, `clearDatamappingAggregatesForMonth`.
- **januaryQueriesDatamapping** / **annualQueriesDatamapping** – Queries equivalentes a las de CloudWatch pero leyendo de tablas `*Datamapping`.
- **getDatamappingRecordsByMonthPaginated** – Paginada por mes para el ETL.

Ver [datamapping-aggregations.md](../datamapping-aggregations.md) para detalles.

### Enriquecimiento RFC (datamappingRecords)

Extracción del RFC y campos de enriquecimiento desde `rawJson`; solo registros con `enrichmentExtracted: false`. Incluye preflight (conteo opcional), reanudación por timeout y backfill único de `enrichmentExtracted`.

Ver [rfc-enrichment-datamapping.md](../rfc-enrichment-datamapping.md) para el proceso completo.

### Queries

- **getDayComparison** – Comparación por fuente para una fecha: conteo, monto total, por movimiento.
- **getMonthSummary** – Resumen mensual.
- **getPaymentsByMonthPaginated** – Paginada para mes (evita límite 8192). Filtro opcional por fuente.
- **getPaymentsBySource**, **searchByReferencia**, **getMonthKPIs**, **getDailyBreakdown**, etc.
- **getPaymentChannelStats** (januaryQueries) – Estadísticas EVO vs Ventanilla (v1+v2) por día, usando `v1Monto`, `v2Monto`, `paymentMonto` de monthStats. Si no hay montos por fuente, estima proporcionalmente.

## Utilidades

- `convex/lib/mexicoDate.ts` – timestampToMexicoDate, timestampToMexicoMonth (UTC a fecha México UTC-6).
- `convex/lib/parsers.ts` – parseV1V2, parsePayment para logs CloudWatch.
