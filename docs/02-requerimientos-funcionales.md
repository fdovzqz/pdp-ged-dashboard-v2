# Requerimientos funcionales

## RF-01 Configuracion declarativa de workflows

El sistema debe permitir definir workflows mediante configuracion versionada (JSON/DSL) sin cambios de codigo para casos operativos normales.

## RF-02 Escaneo previo de alcance

Debe existir un paso de `scan` que determine que periodos, lotes o entidades requieren extraccion/procesamiento antes de ejecutar.

## RF-03 Ejecucion por etapas estandar

Cada workflow debe soportar etapas parametrizables:

- extraction
- cleaning
- deduplication
- reconciliation
- enrichment
- aggregation
- publication/presentation

## RF-04 Politicas de reintento y recuperacion

Cada etapa debe soportar politicas configurables:

- maxRetries
- backoff strategy
- timeout
- retryableErrorCategories
- checkpoint resume

## RF-05 Idempotencia de corrida y etapa

Debe poder reejecutarse una corrida o etapa sin duplicar resultados ni corromper estados.

## RF-06 Control de calidad integrado

Debe ejecutar quality checks configurables en puntos de control:

- pre-ingest
- post-transform
- pre-publish

con estado `pass`, `warn` o `fail`.

## RF-07 Observabilidad por paso

Cada paso debe registrar:

- input resumido
- reglas aplicadas
- resultado
- errores
- output resumido

## RF-08 Manejo de restricciones externas

Debe soportar limites de fuente y destino (paginacion, throttling, cuotas, latencia, OCC) como parte del runtime de ejecucion.

## RF-09 Modo parcial y continuacion

Si una unidad falla, el sistema debe poder completar unidades restantes y dejar evidencia de pendientes para recuperacion dirigida.

## RF-10 Consola operativa y evidencias

Debe exponer estado de corridas, progreso, resultados y evidencias auditables para operación y control.
