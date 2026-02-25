# Proceso determinístico: 3 tablas por fuente, conteo por hora y consolidación

**Objetivo:** Dejar atrás el proceso actual (no determinístico, throttling, pérdida de datos) y definir un flujo en el que (1) cada fuente CloudWatch se escribe en su propia tabla, (2) el volumen se conoce de antemano mediante un query de **conteo por hora** (sin listar), (3) el número de queries de extracción se calcula para no exceder 10k por query, y (4) lo extraído se verifica contra ese conteo. Una vez cargadas las 3 fuentes, un proceso de consolidación genera `paymentRecords`.

**Uso:** Documento de diseño para implementar en una sesión futura. No implementar en la sesión actual.

---

## 1. Contexto del problema actual

- **CloudWatch Logs Insights** limita a **10 000 eventos por query**. Si un día tiene más de 10k eventos en una fuente, una sola query trunca y no hay forma de saber cuántos faltan.
- El proceso actual usa ventanas fijas (4 ventanas de 6h por día) y reintentos; aun con **V2 primero** y pausas de 20s entre fuentes, las ventanas 1–3 de V2 siguen devolviendo **0** en el job mientras `diagnoseV2ForDate` (sin carga previa) devuelve ~8k en la ventana 3. El comportamiento depende del orden y del throttling, no es determinístico.
- No hay verificación: no sabemos si lo extraído coincide con lo que realmente hay en CloudWatch para ese rango.

Para auditoría y conciliación necesitamos un proceso **determinístico** y **verificable**.

---

## 2. Tres tablas, una por fuente

Crear **3 tablas** en Convex, una por cada fuente CloudWatch:

| Tabla | Fuente | Contenido |
|-------|--------|-----------|
| `cloudwatchSourceV1` | Log V1 | Todos los eventos parseados del log group V1 para los rangos cargados. |
| `cloudwatchSourceV2` | Log V2 | Todos los eventos parseados del log group V2 para los rangos cargados. |
| `cloudwatchSourcePayment` | Log Payment | Todos los eventos parseados del log group Payment para los rangos cargados. |

**Propósito:** Copia fiel por fuente. Sin dedup entre fuentes en esta capa; la consolidación (una fila por referencia con prioridad) se hace después.

**Schema sugerido (común para las 3):**

- `_id`, `importDate` (YYYY-MM-DD, día en hora México), `importMonth` (YYYY-MM), `logSource` (v1 | v2 | payment), `timestamp` (del evento), `referencia`, `monto`, `fechaTransaccion`, `estatus`, `movimiento`, `tramiteId` (opcional), y cualquier otro campo necesario para reconciliación.
- Identificador único del evento: por ejemplo `eventId` generado (hash de logSource + timestamp + referencia + índice) o clave compuesta `(logSource, importDate, timestamp, referencia, seq)` para re-sync idempotente (borrar por `importDate` + `logSource` y volver a insertar).
- Índices: por `importDate`, por `(logSource, importDate)`, por `referencia` (para la consolidación).

Los nombres concretos de tablas y campos se pueden alinear con `docs/convencion-nombres-tablas.md` y `docs/plan-cambios-tablas.md` si aplica.

---

## 3. Proceso de carga determinístico

### 3.1 Alcance del periodo

- **Entrada:** periodo a cargar (fecha inicio, fecha fin).
- **Paso 1 – Dividir en meses:** Si el periodo abarca más de un mes, dividirlo en **meses naturales** (ej. 2026-01-01 a 2026-02-22 → enero 2026, febrero 2026). Si el periodo es menor a un mes, tratarlo como un solo bloque (ej. solo 16–22 feb 2026).
- Cada “unidad de trabajo” es un **mes** (o el periodo completo si es &lt; 1 mes). Por cada unidad se ejecuta el flujo siguiente **por cada una de las 3 fuentes**.

### 3.2 Conteo por hora (sin listar eventos)

- Para la unidad (mes o periodo) y para **una fuente** (V1, V2 o Payment), ejecutar un **query de solo conteo** en CloudWatch Logs Insights:
  - Rango: inicio/fin del mes (o del periodo) en UTC (igual que hoy: día México 00:00–23:59:59 → UTC correspondiente).
  - Query que **cuente eventos por hora** (o por intervalo que permita CloudWatch), **sin** devolver los eventos (sin `limit`, sin listar; solo agregación de conteo).
- Objetivo: obtener para cada hora (o cada ventana pequeña) **cuántos** eventos hay. Con eso:
  - Se sabe el **total esperado** para esa fuente en ese periodo.
  - Se sabe **cuántas queries de extracción** hacen falta: si una hora tiene 8k eventos, una query de 10k basta para esa hora; si tiene 25k, hacen falta al menos 3 queries para esa hora (o ventanas más finas). Así **ninguna query de extracción supera 10k** y no hay truncado silencioso.

**Detalle importante:** En CloudWatch Logs Insights, los queries de agregación (ej. `stats count() by bin(1h)`) devuelven solo filas de agregado, no los eventos crudos. Por tanto el “conteo por hora” debe hacerse con ese tipo de query; luego, para cada intervalo de tiempo, se ejecutan uno o más queries de **extracción** (fields @timestamp, @message | limit 10000) con `startTime`/`endTime` ajustados para no exceder 10k en ese intervalo.

- Resultado esperado del paso de conteo: por cada fuente y por cada unidad (mes/periodo), una estructura tipo “por cada intervalo (hora o ventana): cantidad de eventos”. A partir de ahí se calculan los intervalos de extracción (cada uno con ≤10k eventos).

### 3.3 Extracción por intervalos

- Para cada fuente y cada unidad (mes/periodo), y para cada intervalo definido a partir del conteo:
  - Ejecutar uno o más queries de **extracción** (fields @timestamp, @message, etc. | limit 10000) con `startTime` y `endTime` del intervalo, de forma que **nunca** se pidan más de 10k eventos en una sola query.
  - Si un intervalo tiene &gt;10k eventos, subdividirlo (ej. por media hora o por cantidad) y lanzar varias queries hasta cubrirlos todos.
- Parsear cada lote y **insertar en la tabla correspondiente** (`cloudwatchSourceV1`, `cloudwatchSourceV2`, `cloudwatchSourcePayment`).
- **Verificación:** Sumar los eventos insertados para esa fuente y esa unidad. Ese total **debe ser exactamente igual** al total indicado por el query de conteo. Si no coincide, el proceso debe fallar o marcar el run como incompleto y no considerar esa unidad como “cargada” hasta corregir (reintentos, subdivisión más fina, etc.).

### 3.4 Orden y concurrencia

- Se puede procesar **una fuente tras otra** (V1 completo, luego V2 completo, luego Payment) para evitar throttling cruzado; o por unidad (mes) y dentro de ella una fuente tras otra. Lo importante es que el **conteo** y la **extracción** por intervalo estén acotados para no superar 10k por query y que el total extraído se valide contra el conteo.

### 3.5 Resumen del flujo de carga

1. **Entrada:** fecha inicio, fecha fin.
2. **Dividir en meses** (o periodo único si &lt; 1 mes).
3. **Por cada mes (o periodo) y por cada fuente (V1, V2, Payment):**
   - Ejecutar **query de conteo por hora** (o por intervalo) para ese rango; **no listar** eventos.
   - A partir del conteo, **calcular intervalos** de extracción de modo que cada query traiga ≤10k eventos.
   - **Extraer** por intervalos (tantos queries como hagan falta), parsear e **insertar en la tabla de esa fuente**.
   - **Verificar:** total insertado = total del conteo; si no, fallar o marcar y no avanzar.
4. Cuando las **3 fuentes** estén cargadas para el periodo (todas las unidades), pasar a consolidación.

---

## 4. Consolidación → paymentRecords

- **Entrada:** las 3 tablas ya pobladas para el periodo (o para los meses cargados).
- **Proceso:** Leer de `cloudwatchSourceV1`, `cloudwatchSourceV2` y `cloudwatchSourcePayment` (por `importDate` o por rango), agrupar por `referencia`, aplicar la **prioridad** (Payment &gt; V2 &gt; V1, o la definida en RuleSet) y escribir **una fila por referencia** en `paymentRecords` (con `importDate`, `importMonth`, etc., como hoy).
- Así `paymentRecords` sigue siendo la vista deduplicada que consumen reconciliación y reportes, pero la **fuente de verdad** para auditoría son las 3 tablas; la consolidación es repetible y determinística si las 3 tablas lo son.

---

## 5. Requerimientos técnicos (para la sesión futura)

- **CloudWatch:** Definir el query exacto de **conteo por hora** (o por bin) para cada tipo de log (V1, V2, Payment), respetando los mismos filtros que hoy (TaskStateExited, Preparar Datos, etc.). Documentar límites de la API (si hay límite de queries concurrentes, respetarlos; pausas entre fuentes si hace falta).
- **Schema Convex:** Crear las 3 tablas, índices y migración si hay datos actuales que deban moverse.
- **Jobs/acciones:** (1) Job o acción que hace “conteo por hora” y calcula intervalos; (2) job/acción que extrae por intervalo y escribe en la tabla de la fuente; (3) verificación “total insertado = total conteo”; (4) job de consolidación que lee las 3 tablas y actualiza `paymentRecords`.
- **Idempotencia:** Para re-ejecutar un mes, borrar en las 3 tablas los registros de ese `importDate` (o rango) y volver a ejecutar carga + consolidación.

---

## 6. Referencias

- `docs/audit/copia-fiel-fuentes-contexto-y-diseno.md` – Copia fiel por fuente y consolidación.
- `docs/audit/analisis-detallado-v2-2838-vs-9998.md` – Discrepancia fetch job vs diagnose (contexto del problema actual).
- `docs/convencion-nombres-tablas.md`, `docs/plan-cambios-tablas.md` – Nombres y planes de tablas.
