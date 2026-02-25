# Análisis detallado: V2 devuelve 2838 en fetchAndIngestForDate y 9998 en diagnoseV2ForDate (mismo día 2026-02-16)

**Fecha:** 2026-02-24  
**Objetivo:** Enumerar todas las causas posibles (no solo throttling) y qué datos revisar para detectar la causa real.

---

## 1. Hechos observados

| Ejecución | Acción | raw V2 | Sentinela raw V2 |
|-----------|--------|--------|------------------|
| Solo 16 feb (diagnóstico) | `diagnoseV2ForDate` | **9998** | **5/5** |
| Solo 16 feb (carga) | `fetchAndIngestForDate` (job 1 unidad) | **2838** | **0/5** |
| Reintento tras “conteo bajo” | mismo `fetchAndIngestForDate` | **2838** (sin “Reintento mejor”) | 0/5 |

- Mismo día: **2026-02-16**.
- Mismo rango de tiempo: hora México 00:00–23:59:59 (mismo `startTimeSec` / `endTimeSec`).
- Misma función de fetch: `fetchCloudWatchWithWindows("v2", startTimeSec, endTimeSec)`.
- En la carga se ejecuta **antes** el fetch de **V1** (4 ventanas); luego 8 s de pausa; luego V2. En el diagnóstico **solo** se ejecuta V2.

---

## 2. Hipótesis y comprobaciones

### 2.1 Throttling (rate limit) tras V1

- **Hipótesis:** Las 4 ventanas de V1 generan muchas llamadas (StartQuery + GetQueryResults en polling). Tras esa carga, AWS aplica throttling y cuando llega V2 alguna ventana falla o devuelve parcial.
- **Comprobación:** Se añadió pausa de 8 s antes de V2 y un reintento si V2 &lt; 5000. El reintento se ejecutó pero **no** mejoró el conteo (sigue 2838). Eso puede indicar: (a) throttling persistente más allá de 10 s, (b) que la causa no es throttling.
- **Nueva comprobación:** Con el log **por ventana** (`[CloudWatch] v2 ventana 1/4: N filas`) en la próxima ejecución se verá si alguna ventana de V2 devuelve 0 o menos de lo esperado. Si por ejemplo ventanas 1–2 tienen datos y 3–4 devuelven 0, encaja con fallo/throttling por ventana.

### 2.2 Fallo silencioso en una o más ventanas de V2

- **Hipótesis:** En `fetchCloudWatchWithWindows` cada ventana hace `fetchCloudWatch(...).catch(() => [])`. Si una ventana lanza (throttling, timeout, etc.), se devuelve `[]` y no se registraba cuál falló.
- **Comprobación:** Se añadió log por ventana y un `console.warn` cuando una ventana devuelve 0 en un rango de día completo (`totalSec >= 86000`). En la próxima corrida habrá que revisar en los logs de Convex si para V2 alguna ventana muestra 0 filas.

### 2.3 Diferencia de parámetros (fecha, rango, log group)

- **Hipótesis:** En `fetchAndIngestForDate` se usa un `date` o un rango distinto al de `diagnoseV2ForDate`.
- **Comprobación en código:**
  - En ambos casos `date` viene del argumento (en el job: `payload.date` = `"2026-02-16"`).
  - Cálculo del rango: `[y, mo, day] = date.split("-").map(Number)` → `startUtc = Date.UTC(y, mo-1, day, 6, 0, 0, 0)`, `endUtc = Date.UTC(y, mo-1, day+1, 5, 59, 59, 999)` → `startTimeSec`, `endTimeSec`. Idéntico en ambas acciones.
  - Log group: `LOG_GROUPS.v2` (mismo módulo, mismo `process.env` en la misma ejecución de Convex). No hay ramas que cambien log group según la acción.
- **Conclusión:** No hay evidencia de diferencia de parámetros; mismo día, mismo rango, mismo log group.

### 2.4 Entorno o deployment distinto (dev vs prod)

- **Hipótesis:** `diagnoseV2ForDate` se ejecutó en un deployment (o con env) distinto al del job (por ejemplo otra región, otro log group, otras credenciales).
- **Comprobación:** Verificar que el job “Carga por rango” y la ejecución manual de `diagnoseV2ForDate` usan el mismo proyecto/deployment de Convex y las mismas variables de entorno (en Dashboard → Settings → Environment Variables). Si hay dos proyectos (dev/prod), hay que comparar ambos.

### 2.5 Consistencia eventual de CloudWatch Logs Insights

- **Hipótesis:** La API de CloudWatch no garantiza consistencia fuerte; el mismo query podría devolver resultados distintos en dos momentos.
- **Comprobación:** Poco probable para un rango histórico fijo (2026-02-16). Si en la próxima corrida los logs por ventana muestran que las 4 ventanas devuelven datos pero el total sigue siendo 2838, habría que descartar esta causa o contactar a AWS.

### 2.6 Estado interno del cliente AWS SDK

- **Hipótesis:** Tras muchas llamadas (V1), el `CloudWatchLogsClient` podría tener estado (conexiones, límites internos) que afecte a las siguientes llamadas (V2).
- **Comprobación:** Difícil sin cambiar código. Prueba de concepto: en `fetchAndIngestForDate` **cambiar el orden** y hacer **primero V2**, luego V1, luego Payment. Si con ese orden V2 pasa a ~9998 y 5/5 sentinelas, apuntaría a que el orden/carga previa importa (throttling o comportamiento del cliente).

### 2.7 Bug en el uso del resultado del reintento

- **Hipótesis:** Tras el reintento no se está usando el resultado que devuelve más filas.
- **Comprobación en código:** Se usa `rowsV2Final`; si `retryV2.length > rowsV2Final.length` se asigna `rowsV2Final = retryV2` y se hace log “Reintento mejor”. En los logs no aparece “Reintento mejor”, por tanto el reintento **no** devolvió más de 2838. El valor 2838 no viene de un bug de asignación.

### 2.8 Dedup o merge que descarta filas

- **Hipótesis:** Las 4 ventanas devuelven 9998 filas pero al hacer merge por `@timestamp` + `@message` se eliminan muchas por duplicado.
- **Comprobación:** 2838 es muy por debajo de 9998; si todas las ventanas devolvieran datos similares a diagnose, el merge no debería reducir tanto. Con el log por ventana se verá la suma de las 4 ventanas antes del merge; si esa suma es ya ~2838, el problema está en el fetch, no en el merge.

---

## 3. Cambios de código para diagnóstico (ya hechos)

1. **Log por ventana en `fetchCloudWatchWithWindows`**  
   Para cada ventana se hace `console.log("[CloudWatch] ${version} ventana ${i+1}/4: ${part.length} filas")`. En Convex Logs, para la unidad del 2026-02-16 hay que revisar las líneas de V2 y anotar:
   - Ventana 1/4: ? filas  
   - Ventana 2/4: ? filas  
   - Ventana 3/4: ? filas  
   - Ventana 4/4: ? filas  
   Si alguna es 0 o muy baja respecto a las otras, esa ventana es la candidata a fallo/throttling.

2. **Resultado de unidad con desglose por fuente**  
   El handler `cloudwatchSyncByRange` ahora incluye en el resultado de la unidad `rawBySource` y `parsedBySource`. En la UI del run (Registros procesados) se muestran por día/unidad las columnas Raw v1, Raw v2, Raw pay y Parsed v1, v2, pay. Así se ve por unidad cuánto se obtuvo de cada fuente sin depender solo de los logs.

---

## 4. Próximos pasos recomendados

1. **Ejecutar de nuevo solo el 16 feb** (Carga por rango 2026-02-16 a 2026-02-16) y revisar en los logs de Convex:
   - Los 4 logs `[CloudWatch] v2 ventana i/4: N filas` para ese día.
   - Si aparece `[CloudWatch] v2 ventana X/4: 0 filas (posible fallo o throttling)`.
2. **Comparar con diagnoseV2ForDate:** Ejecutar `npx convex run cloudwatchActions:diagnoseV2ForDate '{"date":"2026-02-16"}'` y en los logs ver los mismos 4 líneas para V2 (diagnose también usa `fetchCloudWatchWithWindows`). Si en diagnose las 4 ventanas suman ~9998 y en la carga alguna ventana es 0 o muy baja, la diferencia está en el contexto de ejecución (orden de fuentes, throttling, etc.).
3. **Prueba de orden:** Si se confirma que una o más ventanas de V2 fallan solo en `fetchAndIngestForDate`, probar en código cambiar el orden a **V2 → V1 → Payment** para ese día (o globalmente) y comprobar si V2 pasa a ~9998 y las 5 sentinelas aparecen.

---

## 5. Resumen

- **No se asume que la causa sea throttling.** El reintento no mejoró el conteo, lo que sugiere que o bien el límite de tasa persiste, o la causa es otra.
- **Causas plausibles a comprobar:** (1) Una o más ventanas de V2 devuelven 0 o poco cuando se ejecuta después de V1 (log por ventana). (2) Distinto entorno o deployment entre diagnose y el job. (3) Comportamiento del cliente AWS tras muchas llamadas (prueba: pedir V2 primero).
- **Herramientas añadidas:** Log por ventana en CloudWatch, resultado de unidad con raw/parsed por fuente en la UI del run.
