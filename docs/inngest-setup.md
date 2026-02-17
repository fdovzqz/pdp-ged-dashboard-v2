# Inngest – Conexión básica

Pasos para verificar que Inngest está conectado al proyecto.

## 1. Arrancar Next.js

```bash
npm run dev
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

## Archivos añadidos

| Archivo | Uso |
|--------|-----|
| `src/inngest/client.ts` | Cliente Inngest (`id: "reconciliation"`). |
| `src/inngest/functions.ts` | Función de prueba `testPing` (evento `reconciliation/test.ping`). |
| `src/inngest/datamapping-full-history.ts` | Función `datamappingFullHistory` (evento `reconciliation/datamapping.full-history`) para extracción histórica de datamapping. |
| `src/app/api/inngest/route.ts` | Ruta GET/POST/PUT que expone las funciones a Inngest. |
| `src/app/api/test-inngest/route.ts` | GET que envía un evento de prueba (opcional). |
| `src/app/api/datamapping/full-history/route.ts` | POST que crea un pipeline job y dispara `reconciliation/datamapping.full-history`. |

## Función Datamapping Full History

1. Usuario pulsa "Extraer toda la historia" en Jobs → Datamapping.
2. POST `/api/datamapping/full-history` crea un `pipelineJob` en Convex y envía el evento Inngest.
3. La función `datamapping-full-history` sigue el [patrón de cargas masivas](mass-loads-inngest-pattern.md): **un step por mes** (extraer-mes-2024-01, …, extraer-mes-2026-02), ejecutados **en paralelo**; dentro de cada step, cada día se procesa por chunks para evitar 524/600s. Usa `Promise.allSettled` para obtener `completedMonths` y `failedMonths` y actualiza el job en Convex (progreso, resultado).
4. La UI consulta `getLatestDatamappingFullHistoryJob` para mostrar avance (independiente de refresh/navegación).

## Cargas masivas: patrón y Runs

El mismo patrón (un step por unidad, paralelo, resultado completed/failed) se usa y extenderá para enriquecimientos, agregaciones y reconciliaciones. Ver [mass-loads-inngest-pattern.md](mass-loads-inngest-pattern.md).

En **Inngest Dev Server → Runs**:

- Cada run muestra todos los steps; los mensuales (`extraer-mes-YYYY-MM`) aparecen con barras que se **solapan en el tiempo** (paralelismo).
- Si un step falló y fue reintentado: al expandirlo se ven **Attempt 0** (fallo), **Attempt 1**, **Attempt 2** (verde si el reintento lo solucionó). Así se distingue “completado tras reintento” de “falló tras todos los reintentos”.
- El resultado del job en Convex incluye `failedMonths` para enfocarse en los meses que fallaron.
