# Documentacion del engine configurable

Esta carpeta contiene el nuevo marco de analisis y diseno para evolucionar a un engine reusable, configurable por reglas y auditable.

## Indice

1. [00-contexto-y-problema.md](./00-contexto-y-problema.md)
2. [01-objetivos-y-criterios-de-exito.md](./01-objetivos-y-criterios-de-exito.md)
3. [02-requerimientos-funcionales.md](./02-requerimientos-funcionales.md)
4. [03-requerimientos-no-funcionales.md](./03-requerimientos-no-funcionales.md)
5. [04-modelo-de-datos-y-auditoria.md](./04-modelo-de-datos-y-auditoria.md)
6. [05-engine-de-workflows-configurable.md](./05-engine-de-workflows-configurable.md)
7. [06-diseno-etl-y-reglas-de-calidad.md](./06-diseno-etl-y-reglas-de-calidad.md)
8. [07-observabilidad-reintentos-y-recuperacion.md](./07-observabilidad-reintentos-y-recuperacion.md)
9. [08-presentacion-y-contratos-de-consumo.md](./08-presentacion-y-contratos-de-consumo.md)
10. [09-plan-de-verificacion-y-calidad-auditiva.md](./09-plan-de-verificacion-y-calidad-auditiva.md)
11. [10-matriz-de-decision-refactor-vs-nuevo.md](./10-matriz-de-decision-refactor-vs-nuevo.md)
12. [11-roadmap-de-fases-y-riesgos.md](./11-roadmap-de-fases-y-riesgos.md)
13. [12-arquitectura-tecnologica-y-decisiones.md](./12-arquitectura-tecnologica-y-decisiones.md)
14. [13-ui-ux-plataforma-operativa-futura.md](./13-ui-ux-plataforma-operativa-futura.md)
15. [14-refactor-cutover-y-aceptacion.md](./14-refactor-cutover-y-aceptacion.md)

## Operación y tablas

- [convencion-nombres-tablas.md](./convencion-nombres-tablas.md) – Prefijos por dominio y mapeo nombre actual → propuesto (incl. espejo CloudWatch/DataMapping).
- [plan-cambios-tablas.md](./plan-cambios-tablas.md) – Plan para pruebas integrales: tablas a borrar, limpieza (`internalDataCleanup`), export/import de configuración.
- [enriquecimiento-datamapping.md](./enriquecimiento-datamapping.md) – Enriquecimiento por meses: cómo ejecutar (UI y `POST /api/datamapping/enrich-by-months`), cuándo todo está ya enriquecido (job termina en segundos con 0 procesados), precheck y comprobaciones.

### Rutas API de carga (resumen)

| Acción | Método y ruta | Body relevante |
|--------|----------------|-----------------|
| Sync CloudWatch por rango | `POST /api/cloudwatch/sync-by-months` | `startDate`, `endDate` (YYYY-MM-DD) o `months`, `start`/`end` (YYYY-MM) |
| Sync Datamapping por rango | `POST /api/datamapping/sync-by-months` | Idem |
| Enriquecimiento por meses | `POST /api/datamapping/enrich-by-months` | Opcional: `months`, o `start`/`end` (YYYY-MM) |
| Backfill fechaTransaccion | `POST /api/datamapping/fecha-transaccion-from-date` | `sinceDate` (YYYY-MM-DD) |

La UI en **Configuración → Carga de fuentes** usa estas rutas. **Operaciones** (Control Center, Runs, Rules, Sources, Audit) sirve para monitoreo y reintentos. Reglas: en **Operaciones → Rules** el botón «Asegurar reglas para importación» crea los RuleSets necesarios (dedup, reconciliation, clean, enrichment, quality) si no existen; cada regla tiene «Ver detalle».

## Archivo historico

La documentacion previa fue movida a:

- [archivo/README.md](./archivo/README.md)
