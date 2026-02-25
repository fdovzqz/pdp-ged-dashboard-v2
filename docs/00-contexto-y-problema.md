# Contexto y problema

## Contexto operativo

El sistema actual integra dos fuentes principales:

- CloudWatch Logs hacia `paymentRecords`.
- DynamoDB datamapping hacia `datamappingRecords`.

La orquestacion vigente corre sobre Convex con `pipelineJobs` y `pipelineJobUnits`, reemplazando el flujo principal que antes usaba Inngest para cargas masivas.

## Baseline tecnico actual

### Flujo funcional vigente

1. Extraccion desde fuente externa (CloudWatch o DynamoDB).
2. Parsing y normalizacion por codigo custom.
3. Deduplicacion/Upsert por reglas embebidas.
4. Persistencia en tablas operativas.
5. Agregaciones y reconciliacion por consultas y jobs.
6. Presentacion en dashboards y vistas operativas.

### Restricciones actuales

- Convex: limites de tiempo por action, concurrencia, tamaño de payload y patrones OCC.
- CloudWatch: throttling y paginacion por token.
- DynamoDB: paginacion y dependencia de indices/rangos.
- Operacion: cargas grandes con necesidad de continuidad, reintentos y cierre verificable.

### Hallazgos de robustez

- Existe idempotencia parcial (upsert por `transactionId`, dedup por `referencia`), pero no uniforme por etapa.
- Los reintentos estan presentes en puntos puntuales, no como politica transversal configurable.
- La calidad y validacion de datos no esta centralizada por reglas versionadas.
- La observabilidad es limitada para auditoria fuerte: faltan eventos estandarizados de input/proceso/output por paso.

## Problema a resolver

La logica de negocio y de procesamiento esta distribuida en multiples flujos y handlers custom. Esto dificulta:

- Escalar a fases mas complejas sin reescribir codigo.
- Asegurar que una carga se complete o se recupere automaticamente.
- Auditar con evidencia exacta que entro, que se ejecuto, que fallo, que salio y por que.
- Repetir procesos de forma consistente solo cambiando reglas y parametros.

## Vision objetivo

Disenar un engine reusable, declarativo y configurable por reglas para:

- Extraccion
- Limpieza
- Deduplicacion
- Reconciliacion
- Enriquecimiento
- Agregacion
- Presentacion operativa

con control de calidad, tolerancia a restricciones de origen/destino y trazabilidad auditiva end-to-end.
