# Requerimientos no funcionales

## RNF-01 Disponibilidad operativa

El engine debe soportar ejecucion programada y bajo demanda con disponibilidad orientada a operacion diaria de cargas.

## RNF-02 Rendimiento

- Soportar procesamiento por unidades paralelas configurables.
- Mantener latencia estable frente a paginacion de fuentes grandes.
- Evitar re-procesamiento completo cuando se requiere solo recuperacion parcial.

## RNF-03 Escalabilidad

La arquitectura debe crecer por:

- incremento de volumen historico
- aumento de frecuencia de corridas
- inclusion de nuevas fuentes

sin redisenar el core del motor.

## RNF-04 Confiabilidad

Debe tolerar fallos transitorios y persistir estado suficiente para reanudar sin perdida de contexto.

## RNF-05 Auditabilidad

Toda corrida debe generar evidencia consultable con retencion definida y exportable para auditoria.

## RNF-06 Seguridad y control

- Trazar quien inicia/configura/ejecuta corridas.
- Proteger configuraciones de reglas por version y cambios autorizados.
- Evitar exposicion de payload sensible en logs operativos.

## RNF-07 Mantenibilidad

Las reglas deben aislarse del codigo de infraestructura para simplificar cambios de negocio.

## RNF-08 Observabilidad

El sistema debe emitir metricas, eventos y estados con correlacion entre:

- job
- step
- unidad
- llamada externa

## RNF-09 Compatibilidad con Convex y fuentes

El diseño debe respetar explicitamente limites de:

- tiempo de ejecucion por action
- concurrencia y OCC
- paginacion y throttling de AWS
- tamaño de documentos y payloads

## RNF-10 Gobernanza de calidad

La liberacion a produccion requiere cumplimiento de criterios de calidad, verificacion y evidencia definidos en el plan auditivo.
