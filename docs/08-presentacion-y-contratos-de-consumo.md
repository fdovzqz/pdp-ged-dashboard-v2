# Presentacion y contratos de consumo

## Objetivo

Asegurar que los consumidores (UI, APIs, reportes, auditoria) reciban salidas estables, versionadas y trazables.

## Contratos de salida

## 1) Run status contract

Respuesta estandar para estado de corrida:

- `runId`
- `workflowKey`
- `status`
- `progress` (`current`, `total`, `percentage`)
- `qualityStatus`
- `startedAt`
- `completedAt`
- `summary`

## 2) Reconciliation summary contract

- `scope`
- `totalsBySource`
- `reconciledCount`
- `mismatchCount`
- `onlySourceACount`
- `onlySourceBCount`
- `qualityGateResult`
- `versionInfo`

## 3) Operational evidence contract

- `runId`
- `eventCount`
- `failedUnits`
- `retrySummary`
- `qualitySummary`
- `auditExportRef`

## Versionado de contratos

- Cada respuesta incluye `contractVersion`.
- Cambios breaking requieren version mayor.
- Cambios aditivos usan version menor y compatibilidad backward.

## Reglas de presentacion

- No exponer payload sensible sin mascaramiento.
- Mostrar estado de warning/fail con razon explicita.
- Incluir enlaces a evidencia auditiva por corrida.

## Consumo en UI operacional

Vistas minimas:

1. Monitoreo de corridas activas.
2. Resultado de reconciliacion por periodo.
3. Calidad por etapa.
4. Errores y reintentos.
5. Export de evidencia para auditoria.
