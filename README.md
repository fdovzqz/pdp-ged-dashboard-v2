# Sistema de Reconciliación de Pagos

Sistema para conciliar pagos entre **dos fuentes**: logs CloudWatch (v1, v2, payment) y DynamoDB (datamapping). Los datos se almacenan en Convex y se comparan en un dashboard Next.js. El pipeline de carga y enriquecimiento corre en **Convex** (engine configurable por jobType). **Configuración → Carga de fuentes** permite ejecutar sync por rango (CloudWatch y Datamapping), enriquecimiento por meses y backfill de fechaTransaccion. La UI operativa está en **Operaciones** (Control Center, Runs, Run Detail, Errors, Retries, Rules Catalog, Sources Catalog, Audit).

## Documentación

- **Documentación vigente (engine configurable, análisis y diseño):** [docs/README.md](docs/README.md)
- **Cutover y plan de remoción de código:** [docs/14-refactor-cutover-y-aceptacion.md](docs/14-refactor-cutover-y-aceptacion.md)
- **Archivo histórico (runbooks, patrones previos):** [docs/archivo/README.md](docs/archivo/README.md)

## Inicio rápido

```bash
pnpm install
npx convex dev
pnpm dev
```

Variables de entorno: ver `.env.example`. Para Convex actions, configurar las mismas en Convex Dashboard.

## Estructura

- `convex/` — Backend Convex (pipeline, actions, mutations, queries)
- `src/` — App Next.js (dashboard, configuración, APIs)
- `docs/` — Documentación del engine configurable y análisis
- `docs/archivo/` — Documentación histórica archivada
