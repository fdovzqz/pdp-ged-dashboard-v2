# Copia fiel de fuentes: contexto y diseño

**Objetivo:** Separar en dos capas el proceso de auditoría y reconciliación: (1) **copia fiel** de lo que entregan CloudWatch y DynamoDB, sin dedup ni transformación que reduzca filas; (2) **dedup y filtrado** como paso posterior, sobre esa copia, para reportes y reconciliación. Así se tiene una imagen exacta y determinística de cada fuente y se puede conciliar con confianza.

---

## 1. Contexto

### 1.1 Situación actual

- **CloudWatch (3 logs: V1, V2, Payment)**  
  El pipeline hace fetch por día, parsea y **aplica dedup en memoria** (prioridad Payment > V2 > V1 por referencia). Solo se inserta **una fila por referencia** en `paymentRecords`. No se conserva el detalle de que la misma referencia apareció en varios logs o varias veces.  
  Consecuencia: no existe en Convex una copia fiel de “todo lo que CloudWatch devolvió”; cualquier cambio de prioridad o re-sync altera el resultado y la reconciliación depende de ese resultado ya deduplicado.

- **DynamoDB (datamapping)**  
  La ingestión desde DynamoDB **ya guarda todos los registros** en `datamappingRecords` (upsert por `transactionId`). No se filtra por `status` al cargar; el filtro “PAGO VALIDADO” se aplica **al leer** (queries, reconciliación, tableros).  
  Consecuencia: en DynamoDB sí tenemos una copia fiel de lo que hemos sincronizado; la reconciliación y los reportes aplican filtrado sobre esa copia.

### 1.2 Problema a resolver

Para auditoría y conciliación se necesita:

1. **CloudWatch:** Una tabla (o equivalente) que contenga **todas** las referencias/eventos que devuelve CloudWatch para el rango sincronizado, **sin** dedup en la escritura. A partir de ahí, dedup y filtrado deben ser un paso explícito y repetible.
2. **DynamoDB:** Mantener y documentar que `datamappingRecords` es la **copia fiel** de lo extraído de DynamoDB; no eliminar ni filtrar registros en la carga.

---

## 2. Principio de diseño

- **Capa 1 – Copia fiel:** Almacenar exactamente lo que la fuente entrega (tras un parse mínimo necesario para normalizar campos). Sin dedup, sin descartar filas por reglas de negocio en la escritura.
- **Capa 2 – Dedup / filtrado:** Construir vistas, tablas derivadas o queries que apliquen prioridad por referencia (CloudWatch) o filtro por status (DynamoDB). La reconciliación y los reportes consumen esta capa; si las reglas cambian, se recalcula sobre la copia fiel sin re-ingestar.

---

## 3. Diseño por fuente

### 3.1 CloudWatch: copia fiel + capa dedup

**Estado actual:**  
`fetchAndIngestForDate` obtiene filas de V1, V2 y Payment, parsea, une en un `Map` por `referencia` con prioridad y escribe solo la fila “ganadora” en `paymentRecords`. No se persiste el resto.

**Objetivo:**  
Tener una tabla que represente **cada evento** parseado de CloudWatch (una fila por evento, no por referencia). Sobre esa tabla se construye la vista deduplicada que hoy es `paymentRecords`.

**Opciones de diseño:**

| Opción | Descripción | Pros | Contras |
|--------|-------------|------|--------|
| **A. Nueva tabla `cloudwatchRawRecords`** | Nueva tabla: una fila por evento parseado (referencia, monto, timestamp, logSource, importDate, importMonth, etc.). Clave única: por ejemplo `(logSource, importDate, timestamp, referencia)` o un `eventId` generado (hash de logSource+timestamp+referencia+…). El job de sync escribe aquí **todas** las filas parseadas, sin dedup. Una acción o ETL posterior (o una vista materializada) lee `cloudwatchRawRecords` y escribe/actualiza `paymentRecords` aplicando la regla de prioridad por referencia. | Copia fiel explícita; dedup repetible; se puede cambiar la regla sin re-fetchear. | Duplicación de datos; migración del flujo actual; definir política de retención/limpieza si aplica. |
| **B. Solo cambiar el flujo de escritura** | En `fetchAndIngestForDate`, en lugar de dedup en memoria y escribir solo el ganador, escribir **todas** las filas parseadas en `paymentRecords` (permitiendo varias filas por referencia). Luego, una tabla/vista “dedup” o las queries de reconciliación aplican la prioridad (p. ej. “última por prioridad por referencia”). | Menos cambios de schema; una sola tabla. | `paymentRecords` deja de ser “una fila por referencia” y todas las queries actuales (monthStats, reconciliación por by_referencia) deben pasar a consumir una vista dedup o una tabla derivada. |
| **C. Tabla raw + mantener `paymentRecords` como vista dedup** | Igual que A: `cloudwatchRawRecords` = copia fiel. `paymentRecords` se llena por un proceso que lee `cloudwatchRawRecords`, aplica dedup por referencia (con prioridad configurable) y escribe una fila por referencia. El sync ya no escribe en `paymentRecords`; solo escribe en `cloudwatchRawRecords`. | Compatibilidad con todo lo que hoy usa `paymentRecords` (reconciliación, monthStats, UI); la “fuente de verdad” para auditoría es `cloudwatchRawRecords`. | Dos tablas; proceso de “materialización” de paymentRecords a partir de raw. |

**Recomendación:** **Opción C.**  
- **Copia fiel:** `cloudwatchRawRecords` (nueva tabla) con todos los eventos parseados por día/fuente, sin dedup.  
- **Vista dedup:** `paymentRecords` se alimenta desde `cloudwatchRawRecords` mediante un job/acción que aplica la prioridad (RuleSet) y escribe una fila por referencia. Así la reconciliación y la UI siguen usando `paymentRecords` sin cambios de contrato, y la auditoría puede validar contra `cloudwatchRawRecords`.

**Schema sugerido para `cloudwatchRawRecords` (resumen):**

- Identificador único del evento: p. ej. `eventId` (string, generado para evitar duplicados al re-sincronizar el mismo día).
- Campos del evento: `referencia`, `monto`, `timestamp`, `fechaTransaccion`, `logSource` (v1 | v2 | payment), `movimiento`, `estatus`, `tramiteId` (opcional), `importDate`, `importMonth`.
- Opcional: `rawMessage` o `rawData` (mensaje crudo o JSON) para trazabilidad.
- Índices: por `importDate`, por `(logSource, importDate)`, por `referencia` (para construir la vista dedup y para auditoría).

**Flujo propuesto:**

1. **Sync CloudWatch (por día):** Fetch V1, V2, Payment → parse → para cada fila parseada, insertar en `cloudwatchRawRecords` (sin dedup). Borrar previamente en `cloudwatchRawRecords` los eventos del día (por `importDate`) para re-sync idempotente.
2. **Materializar vista dedup:** Job o acción (por mes o por rango de fechas) que lee `cloudwatchRawRecords`, agrupa por `referencia`, aplica prioridad (payment > v2 > v1 o RuleSet), y escribe/actualiza `paymentRecords` (como hoy: una fila por referencia con importMonth/importDate). Este paso puede ejecutarse después de cada sync o en lote.
3. **Reconciliación y reportes:** Siguen leyendo `paymentRecords` (vista dedup). Para auditoría “conteo crudo por día/fuente” se consulta `cloudwatchRawRecords`.

### 3.2 DynamoDB: copia fiel (ya existente)

**Estado actual:**  
La carga desde DynamoDB escribe en `datamappingRecords` todos los ítems obtenidos (upsert por `transactionId`). No se descartan registros por `status` ni por ningún otro criterio en la escritura. El filtro “PAGO VALIDADO” se aplica en las queries (`by_status_updatedAt`, `by_status_fechaTransaccionMexico`, etc.) y en la acción de reconciliación.

**Objetivo:**  
Dejar explícito que `datamappingRecords` **es** la copia fiel de lo extraído de DynamoDB para el rango sincronizado. Cualquier dedup o filtrado (p. ej. solo PAGO VALIDADO) es responsabilidad de la capa de lectura/reconciliación.

**Diseño:**

- **Copia fiel:** `datamappingRecords` se considera la copia fiel. No se debe filtrar por `status` (ni por ningún otro campo) en la ingestión; si en el futuro se añaden filtros en la extracción desde DynamoDB (p. ej. por rango de fechas o por atributo), documentar que esos filtros son de “alcance del sync”, no de regla de negocio que descarte registros ya traídos.
- **Capa de uso:** Reconciliación, tableros mensual/anual y reportes que requieran “solo PAGO VALIDADO” siguen filtrando por `status` al leer. Opcionalmente se puede introducir una vista materializada o una tabla “datamappingPagoValidado” alimentada desde `datamappingRecords` con filtro `status === 'PAGO VALIDADO'` para no repetir la lógica en cada query; no es estrictamente necesario si las queries actuales son suficientes.

**Documentación:**  
Incluir en la documentación de fuentes (p. ej. `reconciliation-sources-and-criteria.md` o este mismo doc) que:

- `datamappingRecords` = copia fiel de lo sincronizado desde DynamoDB (todos los registros).
- El conjunto “PAGO VALIDADO” es un subconjunto definido al leer (filtro por `status`), no por eliminación en la carga.

---

## 4. Resumen

| Fuente     | Copia fiel                          | Capa dedup / filtrado                    |
|-----------|--------------------------------------|------------------------------------------|
| CloudWatch | Nueva tabla `cloudwatchRawRecords`: todos los eventos parseados por día, sin dedup. | `paymentRecords` alimentada desde raw con prioridad por referencia (RuleSet). Reconciliación y UI siguen usando `paymentRecords`. |
| DynamoDB   | `datamappingRecords`: ya es copia fiel (todos los registros sincronizados).        | Filtro por `status === 'PAGO VALIDADO'` en queries y en `runReconciliation`. |

Con esto se consigue:

1. **Determinismo:** La copia fiel de CloudWatch no depende de la regla de dedup; el mismo fetch siempre produce el mismo conjunto en `cloudwatchRawRecords`. La dedup es un paso posterior y repetible.
2. **Auditoría:** Se puede comparar “todo lo que CloudWatch devolvió para el día X” contra `cloudwatchRawRecords` y validar que no se perdió nada antes de aplicar dedup.
3. **Reconciliación:** Sigue usando la vista dedup (`paymentRecords`) y la vista filtrada de DynamoDB (PAGO VALIDADO), con la garantía de que ambas se construyen sobre copias fieles documentadas.

---

## 5. Próximos pasos (para implementación)

1. Definir schema final de `cloudwatchRawRecords` (campos, índices, política de borrado por `importDate` en re-sync).
2. Modificar `fetchAndIngestForDate` para escribir en `cloudwatchRawRecords` en lugar de (o además de) aplicar dedup y escribir en `paymentRecords`; o introducir un primer job que solo llene `cloudwatchRawRecords` y otro que materialice `paymentRecords`.
3. Implementar el job/acción que lee `cloudwatchRawRecords` y materializa `paymentRecords` con la regla de prioridad actual (RuleSet).
4. Actualizar documentación de fuentes y de reconciliación para reflejar “copia fiel” (CloudWatch → `cloudwatchRawRecords`, DynamoDB → `datamappingRecords`) y “vista para uso” (CloudWatch → `paymentRecords`, DynamoDB → filtro PAGO VALIDADO).
5. (Opcional) Añadir una verificación de auditoría que compare conteos por día/fuente entre lo que devolvió el fetch y lo persistido en `cloudwatchRawRecords`.
