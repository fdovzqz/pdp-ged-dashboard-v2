# Reconciliación DynamoDB (Enero 2026)

Reconciliación de pagos extraídos de CloudWatch (Step Functions) contra registros de DynamoDB datamapping (backup Prod).

## Tabla y GSI

- **Tabla**: `datamappingtable-master-restored-4-feb-2026` (env: `DYNAMODB_DATAMAPPING_TABLE`)
- **GSI**: `DateIndex` — partition key `syncGroup` (valor 1), sort key `updatedAt`
- **Filtro**: `status = "PAGO VALIDADO"`, `updatedAt > "2026-01-01"`

## Flujo

1. **Ingesta DynamoDB → Convex**: action `fetchDatamappingAndIngest({ sinceDate: "2026-01-01" })` o para histórico completo Inngest usa `fetchDatamappingForDayChunk` (por chunk para evitar 524/600s). Consulta el GSI con paginación, mapea cada item con `mapDynamoItemToRecord` e inserta en la tabla `datamappingRecords` (upsert por `transactionId`).
2. **Exploración de atributos**: action `exploreDatamappingAttributes({ sinceDate })` o script `npx tsx scripts/explore-dynamodb-attributes.ts 2026-01-01` para listar las keys del primer item y confirmar nombres de columnas.
3. **Reconciliación**: query `getReconciliationReport({ month: "2026-01" })` compara por `referencia` entre `paymentRecords` (CloudWatch) y `datamappingRecords` (DynamoDB) y devuelve conteos y muestras: solo en CloudWatch, solo en DynamoDB, en ambos (match/mismatch de monto).

## Mapeo de campos (DynamoDB → Convex)

| Columna Convex | Atributos DynamoDB intentados (en orden) |
|----------------|----------------------------------------|
| referencia     | referencia, Referencia                 |
| monto          | monto, total_pagar                     |
| fechaPago      | fechaPago, fechaDePago, fecha de pago |
| fuente         | fuente, Fuente                        |
| urlPago        | urlPago, urlDePago, url de pago      |
| tipoMovimiento | tipoMovimiento, tipo de movimiento, movimiento |
| updatedAt      | updatedAt, UpdatedAt                 |
| rawJson        | JSON completo del item               |

Si los nombres reales en la tabla difieren, ajustar `mapDynamoItemToRecord` en [convex/lib/dynamodb.ts](convex/lib/dynamodb.ts).

## Variables de entorno

En Convex Dashboard (Environment Variables) para las actions: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DYNAMODB_DATAMAPPING_TABLE`. Si tu tabla usa un GSI con otro nombre (no `DateIndex`), añade `DYNAMODB_DATAMAPPING_INDEX` con el nombre real del índice (partition: `syncGroup`, sort: `updatedAt`).
