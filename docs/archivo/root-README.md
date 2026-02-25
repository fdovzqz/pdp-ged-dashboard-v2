# Sistema de Reconciliación de Pagos

Sistema para conciliar pagos entre **dos fuentes**: logs CloudWatch (v1, v2, payment) y DynamoDB (datamapping). Los datos se almacenan en Convex y se comparan en un dashboard Next.js. La extracción, el filtrado/dedup, las estadísticas por mes y la UI de "Registros cargados" están estandarizados en formato espejo entre ambas fuentes; la reconciliación compara por referencia y el detalle muestra las diferencias.

## Fuentes de Datos

### CloudWatch (paymentRecords)

| Fuente | Log Group | Descripción |
|--------|-----------|-------------|
| **V1** | ReconciliationProcessAndConfirmationStateMachineLogs | Conciliación legacy |
| **V2** | ReconciliationProcessAndConfirmationStateMachineV2Logs | Conciliación producción |
| **EVO (TC)** | PaymentProcessStateMachineLogs | Procesador de tarjetas de crédito |

### DynamoDB (datamappingRecords)

Los registros de datamapping se cargan desde DynamoDB vía el motor de pipeline (histórico completo, load-from-date, incremental). Para reconciliación y tableros se consideran solo los que tienen `status === "PAGO VALIDADO"`. Ver [docs/reconciliation-sources-and-criteria.md](docs/reconciliation-sources-and-criteria.md).

## Reglas de Negocio

### Prioridad de deduplicación

Cuando una misma referencia aparece en varias fuentes, se conserva: **Payment > V2 > V1**.

### Zona horaria (México UTC-6)

- Todos los rangos de fecha se interpretan en hora local México.
- **00:00 México** = 06:00 UTC
- **23:59:59.999 México** = 05:59:59.999 UTC del día siguiente
- El campo `importDate` se calcula desde el timestamp UTC convertido a fecha México.

### Sync desde CloudWatch

Al sincronizar para una fecha:

1. Se borran registros existentes de esa fecha (por `importDate` y por referencias).
2. Se consulta CloudWatch en el rango UTC equivalente al día México.
3. Se deduplica con prioridad Payment > V2 > V1.
4. Se insertan en Convex.

Documentación detallada del proceso de extracción: [extraction-process.md](extraction-process.md).

## Estructura del Proyecto

```
reconciliation/
├── convex/              # Backend Convex
│   ├── actions.ts       # fetchAndIngestForDate, recreateMonthStatsFromPaymentRecords
│   ├── mutations.ts     # ingestPaymentBatch, deletePaymentsBy*, updateMonthStatsFromDay
│   ├── queries.ts       # getDayComparison, getMonthSummary, etc.
│   ├── januaryETL.ts    # buildJanuaryAggregates (CloudWatch)
│   ├── datamappingETL.ts # buildDatamappingAggregates (DynamoDB)
│   ├── januaryQueries.ts
│   ├── januaryQueriesDatamapping.ts
│   ├── januaryMutations.ts
│   ├── datamappingMutations.ts
│   ├── schema.ts        # paymentRecords, monthStats, etc.
│   └── lib/
│       ├── mexicoDate.ts
│       └── parsers.ts
├── src/                 # App Next.js
│   ├── app/
│   │   ├── page.tsx     # Dashboard principal Enero
│   │   ├── configuracion/  # Configuración: datos, carga fuentes, agregaciones, status
│   │   ├── v1/          # Dashboard V1 legacy
│   │   └── api/
│   │       ├── v1/payments-by-day/
│   │       ├── explore/
│   │       ├── payments-by-day/
│   │       └── payments-by-txn-date/
│   ├── components/
│   ├── lib/
│   └── providers/
├── scripts/             # Scripts CLI (descarga, ingesta, análisis)
└── .env.example
```

## Inicio Rápido

### 1. Configurar variables de entorno

Copiar `.env.example` a `.env.local` en la raíz:

```env
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
CLOUDWATCH_LOG_GROUP_V1=/aws/vendedlogs/states/ReconciliationProcessAndConfirmationStateMachineLogs/master
CLOUDWATCH_LOG_GROUP_V2=/aws/vendedlogs/states/ReconciliationProcessAndConfirmationStateMachineV2Logs/master
CLOUDWATCH_LOG_GROUP_PAYMENT=/aws/vendedlogs/states/PaymentProcessStateMachineLogs/master
NEXT_PUBLIC_CONVEX_URL=https://xxx.convex.cloud
```

Para la action de Convex, configurar las mismas variables en **Convex Dashboard > Settings > Environment Variables**.

### 2. Convex

```bash
npx convex dev
```

### 3. App Next.js

```bash
pnpm install
pnpm dev
```

Abrir http://localhost:3000

### 4. Sincronizar datos

En la UI, clic en **"Sincronizar desde CloudWatch"** para el 15 de enero 2026.

## APIs del Dashboard

| Endpoint | Uso |
|----------|-----|
| **GET /api/v1/payments-by-day** | Frontend: página V1 (pagos por día) |
| **GET /api/explore** | Frontend: explorar logs CloudWatch |
| **GET /api/payments-by-day** | Scripts: agregado por día |
| **GET /api/payments-by-txn-date** | Scripts: filtro por fecha de transacción |

## Scripts

Scripts en `scripts/` para operaciones CLI:

| Script | Descripción |
|--------|-------------|
| `ingest-to-convex.ts` | Ingesta archivos JSON desde `data/` a Convex |
| `ingest-january-2026.ts` | Descarga e ingesta Enero 2026 desde CloudWatch |
| `download-january-15-samples.ts` | Descarga logs crudos del 15 de enero |
| `fetch-january-stats.ts` | Obtiene stats vía API (requiere dashboard en localhost) |
| `fetch-january-v1-by-txn-date.ts` | Análisis V1 por fecha transacción |
| `fetch-v1-january-by-hour.ts` | Distribución horaria V1 |
| `fetch-v1-v2-january-2026-by-hour.ts` | Distribución horaria V1+V2 |

Los scripts `fetch-*` son herramientas de análisis ad-hoc y requieren el dashboard ejecutándose en localhost.

## Registros cargados (Carga de fuentes)

En **Configuración → Carga de fuentes** la card **Registros cargados** compara las tablas Convex `paymentRecords` (CloudWatch) y `datamappingRecords` (DynamoDB). Se muestran: **paymentRecords**, **datamappingRecords** (total, PAGO VALIDADO, PAGO VALIDADO - DEC), **DataMapping (PV − DEC)** — (PAGO VALIDADO − PAGO VALIDADO DEC), valor comparable con paymentRecords — y **Diferencia** = paymentRecords − DataMapping (PV − DEC), por total, año, mes y día. Botones **Recalcular paymentRecords** y **Recalcular datamappingRecords**. Las estadísticas se actualizan solas al cargar/borrar (incremental en mutaciones). **Borrar mes** y **Borrar todo (paymentRecords)** están en la card **Sincronizar CloudWatch**. Criterio de “mes”: paymentRecords = fecha del evento; datamappingRecords = updatedAt (las diferencias por mes pueden ser grandes sin ser error). Ver [docs/jobs-page.md](docs/jobs-page.md) y [docs/reconciliation-sources-and-criteria.md](docs/reconciliation-sources-and-criteria.md).

## Cargas masivas (motor Convex)

Las cargas de **CloudWatch** y **datamapping** se orquestan con el **motor de pipeline en Convex**:

- **Carga por rango (recomendada):** En ambas fuentes, "Carga por rango" usa **una unidad por día** en el intervalo (fecha inicio–fin), con **hasta 6 workers en paralelo** (`datamapping_sync_by_range`, `cloudwatch_sync_by_range`).
- **Unidades en cola** (`pipelineJobUnits`): Jobs paralelos comparten límite de concurrencia (default 6; configurable por job). Límite ~10 min por unidad.
- **Progreso:** Status de actualizaciones (`/configuracion/status`); cancelación con `cancelPipelineJob`; recuperación de unidades atascadas con `recoverStuckPipelineUnits`.
- **Stats:** Durante ingestas paralelas se usa `skipStatsUpdate`; al finalizar se programa `getDatamappingIngestionStats` (DDB) o `recreateAllMonthStatsFromPaymentRecords` (CW).

Ver [docs/refactor-pipeline-convex.md](docs/refactor-pipeline-convex.md) y [docs/mass-loads-pipeline-pattern.md](docs/mass-loads-pipeline-pattern.md).

## Documentación Adicional

- [docs/reconciliation-sources-and-criteria.md](docs/reconciliation-sources-and-criteria.md) – **Fuentes y criterios para reconciliación** (conjunto comparable, criterio de mes, Opción 1/2, stats por fuente)
- [docs/refactor-pipeline-convex.md](docs/refactor-pipeline-convex.md) – **Motor de pipeline en Convex** (diseño y migración desde Inngest)
- [docs/mass-loads-pipeline-pattern.md](docs/mass-loads-pipeline-pattern.md) – **Patrón de cargas masivas en Convex** (flujo estándar, filtrado/dedup, unidades, finalize, jobs CW y DDB)
- [docs/mass-loads-inngest-pattern.md](docs/mass-loads-inngest-pattern.md) – Patrón legacy con Inngest (referencia)
- [docs/datamapping-full-history-runbook.md](docs/datamapping-full-history-runbook.md) – Runbook: histórico completo datamapping
- [extraction-process.md](extraction-process.md) – Proceso de extracción desde CloudWatch (queries, parsing, deduplicación)
- [cloudwatch-queries.md](cloudwatch-queries.md) – Queries CloudWatch para V1, V2 y PaymentProcess
- [reconciliation-dynamodb.md](reconciliation-dynamodb.md) – Reconciliación CloudWatch vs DynamoDB (datamapping)
- [datamapping-aggregations.md](datamapping-aggregations.md) – Análisis Mensual y Anual desde DataMapping (tablas agregadas)
- [docs/jobs-page.md](docs/jobs-page.md) – Configuración: Carga de fuentes (Registros cargados, sync CloudWatch por meses en paralelo, Borrar en card CW, carga DynamoDB), Enriquecimiento, Status de actualizaciones (pipelines)
- [docs/inngest-setup.md](docs/inngest-setup.md) – Configuración básica de Inngest
- [docs/production-setup.md](docs/production-setup.md) – **Puesta en producción**: Vercel, Convex (prod) e Inngest
- [convex/README.md](convex/README.md) – Funciones Convex del proyecto
