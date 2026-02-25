# Inngest – Conexión básica

**Los pipelines de datamapping (full-history, clear, enrichment, etc.) ya no usan Inngest;** corren con el [motor de pipeline en Convex](refactor-pipeline-convex.md). Esta ruta y documento siguen siendo útiles para la función de prueba `testPing` y cualquier otro evento que se quiera enviar a Inngest.

Pasos para verificar que Inngest está conectado al proyecto.

## 1. Arrancar Next.js

```bash
pnpm dev
```

La app debe estar disponible (p. ej. http://localhost:3000).

## 2. Arrancar Inngest Dev Server

En **otra terminal**:

```bash
npx inngest-cli@latest dev
```

- El Dev Server queda en **http://localhost:8288**.
- Escaneará tu app (por defecto en http://localhost:3000) para descubrir la ruta `/api/inngest`.

## 3. Probar la función

**Opción A – Desde el Dev Server**

1. Abre http://localhost:8288
2. Pestaña **Functions**: deberías ver la función **"Test Ping (conexión Inngest)"**.
3. Pulsa **Invoke** y envía un payload (o vacío `{}`).
4. En **Runs** verás la ejecución y el resultado.

**Opción B – Desde la app**

1. Con Next.js e Inngest Dev Server en marcha, abre en el navegador:
   ```
   http://localhost:3000/api/test-inngest
   ```
2. Deberías recibir `{ "ok": true, "message": "Evento reconciliation/test.ping enviado a Inngest." }`.
3. En http://localhost:8288 → **Runs** aparecerá una nueva ejecución de **test-ping**.

## Archivos relevantes

| Archivo | Uso |
|--------|-----|
| `src/inngest/client.ts` | Cliente Inngest (`id: "reconciliation"`). |
| `src/inngest/functions.ts` | Función de prueba `testPing` (evento `reconciliation/test.ping`). |
| `src/app/api/inngest/route.ts` | Ruta GET/POST/PUT que expone las funciones a Inngest (solo testPing si los pipelines ya migraron a Convex). |
| `src/app/api/test-inngest/route.ts` | GET que envía un evento de prueba (opcional). |

## Pipelines de datamapping

Los jobs de datamapping (full-history, clear, enrichment, load-from-date, fecha-transaccion, incremental) **ya no usan Inngest**. Crean un `pipelineJob` en Convex y arrancan el motor con la mutation `startPipelineJob`. Ver [refactor-pipeline-convex.md](refactor-pipeline-convex.md) y [mass-loads-pipeline-pattern.md](mass-loads-pipeline-pattern.md).
