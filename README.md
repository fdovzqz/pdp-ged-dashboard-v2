# Sistema de Reconciliación de Pagos

Sistema para conciliar pagos de 3 fuentes de logs CloudWatch, almacenados en Convex, con dashboard Next.js para visualización y comparación.

## Fuentes de Datos

| Fuente | Log Group | Descripción |
|--------|-----------|-------------|
| **V1** | ReconciliationProcessAndConfirmationStateMachineLogs | Conciliación legacy |
| **V2** | ReconciliationProcessAndConfirmationStateMachineV2Logs | Conciliación producción |
| **EVO (TC)** | PaymentProcessStateMachineLogs | Procesador de tarjetas de crédito |

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
npm install
npm run dev
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

## Cargas masivas (Inngest)

Las cargas masivas (p. ej. histórico completo de datamapping, ~900k registros) se orquestan con **Inngest** siguiendo un patrón estándar:

- **Un step por unidad** (p. ej. un mes): si falla una unidad, solo esa se reintenta.
- **Ejecución en paralelo** (p. ej. 26 meses a la vez).
- **Chunks** dentro de cada step para evitar timeouts (524/600s).
- **Resultado explícito**: `completedMonths` (ok) y `failedMonths` (fallaron tras reintentos) para saber en qué enfocarse.

El mismo patrón se aplica a enriquecimientos, agregaciones y reconciliaciones. Ver [docs/mass-loads-inngest-pattern.md](docs/mass-loads-inngest-pattern.md).

## Documentación Adicional

- [docs/mass-loads-inngest-pattern.md](docs/mass-loads-inngest-pattern.md) – **Patrón de cargas masivas con Inngest** (steps por unidad, paralelo, reintentos, resultado completed/failed)
- [docs/datamapping-full-history-runbook.md](docs/datamapping-full-history-runbook.md) – Runbook: histórico completo datamapping
- [extraction-process.md](extraction-process.md) – Proceso de extracción desde CloudWatch (queries, parsing, deduplicación)
- [cloudwatch-queries.md](cloudwatch-queries.md) – Queries CloudWatch para V1, V2 y PaymentProcess
- [reconciliation-dynamodb.md](reconciliation-dynamodb.md) – Reconciliación CloudWatch vs DynamoDB (datamapping)
- [datamapping-aggregations.md](datamapping-aggregations.md) – Análisis Mensual y Anual desde DataMapping (tablas agregadas)
- [docs/jobs-page.md](docs/jobs-page.md) – Configuración: Gestión de datos, Carga de fuentes, Enriquecimiento y agregaciones, Status de actualizaciones (pipelines, sync CloudWatch, carga DynamoDB, agregados, backfill)
- [docs/inngest-setup.md](docs/inngest-setup.md) – Configuración básica de Inngest
- [docs/production-setup.md](docs/production-setup.md) – **Puesta en producción**: Vercel, Convex (prod) e Inngest
- [convex/README.md](convex/README.md) – Funciones Convex del proyecto
