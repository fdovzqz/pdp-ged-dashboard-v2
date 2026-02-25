# Runbook: Extracción histórica completa de Datamapping

Instrucciones para ejecutar y verificar la extracción histórica de datamapping (2024-01 hasta hoy).

## Prerrequisitos

- Next.js en ejecución: `pnpm dev`
- Convex en ejecución: `npx convex dev`
- Inngest Dev Server en ejecución: `npx inngest-cli@latest dev`
- Variables de entorno configuradas (AWS, DynamoDB, Convex)

## Paso 1: Borrar datamapping existente (obligatorio)

**Importante:** La tabla `datamappingRecords` usa `transactionId` como llave única (DynamoDB). Si tienes registros antiguos sin `transactionId`, debes borrarlos antes de la primera importación con este schema.

1. Ir a **Jobs** → sección **Datamapping (DynamoDB)**.
2. Hacer clic en **"Borrar datamapping"** (botón rojo).
3. Confirmar en el cuadro de diálogo.
4. Se crea un `pipelineJob` y se dispara el evento Inngest `reconciliation/datamapping.clear`.
5. El job corre en Inngest (independiente de la UI). Ver el avance: barra de progreso y resultado (`totalDeleted` registros).
6. Puede tardar varios minutos con ~900k registros (borra en lotes de 2000).

## Paso 2: Ejecutar "1. Histórico completo"

1. En la misma sección, hacer clic en **"Extraer toda la historia"**.
2. Se crea un `pipelineJob` y se dispara el evento Inngest `reconciliation/datamapping.full-history`.
3. El job corre en Inngest (independiente de la UI).
4. Ver el avance: barra "Procesando 26 meses en paralelo...". **Un step por mes (en paralelo)**: si un mes falla, Inngest reintenta solo ese step. Al final el resultado indica `completedMonths` (ok) y `failedMonths` (fallaron tras reintentos) para enfocarse en esos. Cada día se procesa por chunks para evitar 524/600s.
5. Se puede refrescar o navegar a otras páginas y volver: el estado se mantiene en Convex.

**Inngest Dev Server (http://localhost:8288 → Runs)**: al ejecutar el job, en el run se ven todos los steps `extraer-mes-YYYY-MM` con barras que se solapan (paralelismo). Si un mes falló y fue reintentado, al expandir ese step se ven **Attempt 0** (fallo), **Attempt 1**, **Attempt 2** (verde si el reintento lo solucionó). Ver [mass-loads-inngest-pattern.md](mass-loads-inngest-pattern.md).

## Paso 3: Verificación

### 3.1 Registros en Convex vs DynamoDB

- **Job completado (o parcial)**: el resultado incluye:
  - `totalInserted`, `totalUpdated` (solo de meses que terminaron bien).
  - `completedMonths`: lista de meses que terminaron sin error (en el primer intento o tras reintento).
  - `failedMonths`: lista `{ ym, error }` de meses que fallaron tras todos los reintentos; enfocarse en estos para re-ejecutar o investigar.
  - `byMonth`: por cada mes, `{ inserted, updated, status: "completed" }` o `{ status: "failed", error }`.
  - `summary`: texto resumen (p. ej. "26 meses ok" o "24 meses ok, 2 fallaron tras reintentos").
- **Registros únicos en Convex**: usamos upsert por `transactionId`, así que hay un registro por transacción (la última versión por `updatedAt`).
- **Comparar con DynamoDB**:  
  - En DynamoDB: contar ítems con `syncGroup=1` y `updatedAt` en el rango 2024-01-01 … 2026-02-28 (o el rango configurado).  
  - En Convex: en el dashboard, tabla `datamappingRecords`, consultar el total de documentos.  
  - Deberían coincidir o ser muy cercanos (Convex puede tener menos si hay varias versiones de la misma transacción).

### 3.2 Watermark

- **Dónde se guarda**: tabla `processingControl`, fila con `key: "datamapping_watermark"`, campo `lastProcessedTimestamp`.
- **Qué valor tiene**: el `updatedAt` más reciente de los registros extraídos (marca de hasta dónde se procesó).
- **En la UI**: en la sección **"3. Incremental (últimos cambios)"** se muestra "Marca actual: {valor}" cuando existe.
- **Comprobación**: el valor debe ser un timestamp ISO (p. ej. `2026-02-28T23:59:59.999Z`) coherente con el último mes extraído.

### 3.3 Resumen rápido de verificación

| Verificación                 | Dónde                               | Esperado                                      |
|-----------------------------|-------------------------------------|-----------------------------------------------|
| Total insertados + actualizados | Resultado del job en la UI          | ~900k (según datos en DynamoDB)               |
| Registros en Convex         | Dashboard Convex → datamappingRecords | Similar o menor (sin duplicados por transactionId) |
| Watermark                   | Jobs → "Marca actual" en Incremental | Timestamp ISO del último mes procesado        |

## Rendimiento observado

- **Carga completa (full-history)**: en entorno de desarrollo (Inngest Dev Server, Convex, Next.js locales), la extracción histórica de **todos los meses** (2024-01 … 2026-02) con enriquecimiento en la carga (RFC, placa, evoId, etc.) completó en **~20 minutos** (ejemplo: Queued 2:24:50 → Ended 2:44:29).
- En Inngest Runs se ve el trace: `marcar-running`, steps `extraer-mes-YYYY-MM` en paralelo, `actualizar-watermark-y-co...`, `Finalization`. Los steps por mes se solapan en el tiempo; la duración total depende del volumen por mes y del paralelismo.

## Notas

- Si el job falla (524, 500, timeout 600s), el `pipelineJob` queda en `failed` y se muestra el mensaje de error. **Se puede volver a ejecutar "Extraer toda la historia"**: es idempotente (upsert por `transactionId`) y rellenará los días o chunks que no se llegaron a procesar. No hay duplicados.
- Una diferencia de ~8k respecto a DynamoDB puede deberse a 1–2 días que fallaron por timeout; un segundo run suele cubrirlos.
- El job de borrado (Paso 1) borra tanto los registros como la marca de agua, así que tras un clear exitoso el incremental puede volver a empezar desde cero.
- **Mismo patrón** para enriquecimientos, agregaciones y reconciliaciones: ver [mass-loads-inngest-pattern.md](mass-loads-inngest-pattern.md).
