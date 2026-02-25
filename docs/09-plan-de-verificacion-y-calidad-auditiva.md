# Plan de verificacion y calidad auditiva

## Objetivo

Definir un proceso disciplinado para validar que cada corrida:

- ejecuta lo que debe ejecutar,
- completa lo necesario,
- reporta errores reales,
- y produce evidencia auditable suficiente.

## Marco de verificacion

## Fase A: Verificacion de configuracion

- Validar version de workflow y ruleset activo.
- Confirmar parametros de scope y politicas de retry.
- Verificar prerequisitos de fuente y destino.

## Fase B: Verificacion de ejecucion

- Confirmar transiciones de estado correctas por step y unidad.
- Validar que cada unidad tenga inicio/fin/error segun corresponda.
- Confirmar aplicacion de checkpoints y reintentos.

## Fase C: Verificacion de datos

- Validar completitud de extraccion vs scan inicial.
- Validar reglas de limpieza/dedup aplicadas.
- Validar reconciliacion y enriquecimiento contra umbrales.

## Fase D: Verificacion de publicacion

- Confirmar consistencia de agregados y contratos de salida.
- Confirmar disponibilidad de evidencia operativa y auditiva.

## Evidencias minimas por corrida

1. Manifiesto de corrida (workflow, version, scope, actor, timestamp).
2. Bitacora de pasos y unidades con estados.
3. Registro de errores y reintentos.
4. Resultados de quality checks (pass/warn/fail).
5. Resumen de reconciliacion y diferencias.
6. Referencia de export auditivo.

## Criterios de aceptacion

Una corrida se considera aceptada si:

- no hay pasos criticos en `failed`,
- quality gates criticos estan en `pass`,
- diferencias de reconciliacion estan dentro de tolerancia o justificadas,
- evidencia auditiva esta completa y accesible.

## Checklist operativo de auditoria

- [ ] Scan ejecutado y aprobado.
- [ ] Workflow versionado identificado.
- [ ] Reintentos aplicados segun politica.
- [ ] Unidades fallidas clasificadas y tratadas.
- [ ] Quality checks registrados.
- [ ] Reconciliacion emitida con trazabilidad.
- [ ] Contratos de salida validados.
- [ ] Evidencia auditiva exportable y retenida.

## Pruebas recomendadas

### Pruebas funcionales

- carga completa en rango controlado
- carga parcial con fallo inyectado
- reanudacion desde checkpoint

### Pruebas no funcionales

- stress de concurrencia
- simulacion de throttling/OCC
- validacion de retencion y consulta de evidencias
