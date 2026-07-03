# Runbook: actualizar datos de producción (2026)

Procedimiento ejecutado y verificado el 2026-07-02/03 para poner al día los datos (estaban detenidos desde el 26 de febrero). Todo corre contra producción sin tocar el código; solo llamadas HTTP a la app deployada y a Convex.

Convex prod: `https://strong-horse-547.convex.cloud` (API pública `/api/query`, `/api/action`, `/api/mutation`).
App deployada: `https://pdp-ged-dashboard-financiero-red.vercel.app`.

## Orden de ejecución

1. **Sync CloudWatch** (paymentRecords; dedup por referencia integrado):

   ```bash
   curl -X POST https://pdp-ged-dashboard-financiero-red.vercel.app/api/cloudwatch/sync-by-months \
     -H 'Content-Type: application/json' -d '{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}'
   ```

   Corre con concurrencia 1 (AWS Logs Insights). Para acelerar (probado con 4 sin fallas):

   ```bash
   curl -X POST https://strong-horse-547.convex.cloud/api/mutation -H 'Content-Type: application/json' \
     -d '{"path":"pipelineMutations:setPipelineJobConcurrency","args":{"jobId":"<jobId>","maxConcurrency":4},"format":"json"}'
   ```

2. **Sync DataMapping** (DynamoDB → Convex; upsert idempotente por transactionId):

   ```bash
   curl -X POST https://pdp-ged-dashboard-financiero-red.vercel.app/api/datamapping/sync-by-months \
     -H 'Content-Type: application/json' -d '{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}'
   ```

   Puede correr en paralelo con el paso 1.

3. **Backfill fechaTransaccion** (requiere que el paso 1 haya terminado — toma la fecha de paymentRecords por referencia; fallback a updatedAt):

   ```bash
   curl -X POST https://pdp-ged-dashboard-financiero-red.vercel.app/api/datamapping/fecha-transaccion-full \
     -H 'Content-Type: application/json' -d '{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}'
   ```

4. **Reconstruir agregados** (alimentan tableros mensual/anual/EVO por fuente):

   ```bash
   curl -X POST https://strong-horse-547.convex.cloud/api/action -H 'Content-Type: application/json' \
     -d '{"path":"datamappingETL:buildDatamappingAggregates","args":{"months":["2026-06","2026-07"]},"format":"json"}'
   ```

5. **Stats de ingestión por mes** (vistas de configuración):

   ```bash
   curl -X POST https://strong-horse-547.convex.cloud/api/action -H 'Content-Type: application/json' \
     -d '{"path":"datamappingActions:recreateDatamappingMonthStatsByFechaTransaccion","args":{},"format":"json"}'
   ```

## Monitoreo de jobs

```bash
curl -s https://strong-horse-547.convex.cloud/api/query -H 'Content-Type: application/json' \
  -d '{"path":"pipelineQueries:getPipelineJob","args":{"jobId":"<jobId>"},"format":"json"}'
```

`result.failedDays` / `result.failedMonths` listan unidades a re-ejecutar (re-lanzar el mismo endpoint con solo ese rango).

## Verificación

- `cloudwatchQueries:getMonthStats {month:"YYYY-MM"}` → kpis.totalPagos/montoTotal debe ≈ el total del mes en `aggregatesDatamappingQueries:getPaymentChannelStats {year,month}`. Si el segundo es mucho menor, falta backfill de fechaTransaccion en ese rango (ver pitfall abajo).

## Pitfall conocido (causa del incidente de datos viejos y de enero sub-reportado)

Los tableros por fuente (`datamappingDailyFuenteBreakdown`, canal EVO/DEC) solo cuentan registros con `fechaTransaccionMexico` seteado. Cargar registros **no basta**: si no corre el backfill (paso 3) + agregados (paso 4), los meses nuevos no aparecen y los parciales sub-reportan. Enero 2026 mostró $95.5M durante meses cuando lo real es $356.3M; se corrigió el 2026-07-02 corriendo el backfill de todo enero–febrero.

## Nota sobre fuentes

- La tabla DynamoDB viva es `sam-service-data-DataMappingTable-M7WYQ7TWG6I0` (configurada en Convex env; solo lectura).
- En enero hubo duplicados masivos por los problemas de procesamiento: siempre validar contra CloudWatch (notificaciones de pago) que es la fuente confiable de fechas y del conteo real.
- Para reportes ejecutivos existe la app independiente `evo-pagob-report` (analisis-evo.durango.vantik.lat) que lee estos agregados vía la API pública de Convex.

## Actualización automática nocturna (configurada 2026-07-03)

Ya **no es necesario correr el runbook a mano** en operación normal. Un cron nativo de Convex (`convex/crons.ts`, job `actualizacion-nocturna-datos`) corre todos los días a las **02:30 hora de México** (08:30 UTC) y ejecuta la cadena completa en `convex/nightlyUpdate.ts`:

1. Sync CloudWatch + sync DataMapping de los últimos 3 días (upserts idempotentes; re-sincronizar días ya cargados es seguro).
2. Al completarse ambos → backfill de fechaTransaccion del mismo rango.
3. Al completarse → `buildDatamappingAggregates` de los meses tocados + `recreateDatamappingMonthStatsByFechaTransaccion`.

La orquestación es una máquina de estados con `ctx.scheduler` que verifica cada 2 min el estado de los jobs (`externalId` con prefijo `nightly-`); si un job falla o tarda más de ~4 h, la corrida se abandona y queda registrada en los logs de Convex (`[nightly] ...`) y en `pipelineJobs` (visibles en la página Operaciones → Runs).

- **Ejecutar manualmente** (mismo efecto que el cron): `npx convex run nightlyUpdate:start` con `CONVEX_DEPLOY_KEY` de producción, o desde el dashboard de Convex → Functions.
- **El runbook manual de arriba sigue aplicando** para backfills históricos o rangos grandes (más de ~1 semana).
