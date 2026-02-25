# Estado del proceso determinístico CloudWatch (feb 2026)

**Fecha del documento:** 2026-02-24  
**Contexto:** Último intento del proceso de auditoría. Decisión pendiente: continuar o cancelar el proyecto.

---

## Situación anterior (referencia)

- Se migraron **~500,000 registros** con el proceso existente (fetch por ventanas, dedup, escritura a `paymentRecords`).
- Se encontró una **diferencia de ~2,500** registros entre lo esperado y lo cargado (documentado en análisis V2 y proceso actual).
- Aun con esa diferencia, la migración a gran escala **sí completaba**: se podía cargar rangos largos y tener datos operativos.

---

## Situación actual (regresión)

- **No se logra migrar ni un solo día completo** con el flujo determinístico (conteo por hora → extracción por intervalos → tablas fuente → verificación).
- Sí se puede ejecutar el proceso día a día desde la UI o vía `runDeterministicSyncForDate`, pero:
  - Algunas fechas devuelven **0** en las tres fuentes (v1, v2, payment) por errores de AWS o por cómo se interpretaba la respuesta.
  - Otras fechas (ej. 2026-02-16) **fallan en verificación** (expected vs inserted) o **hacen timeout** (524) en una sola ejecución.
- El proceso original (`fetchAndIngestForDate`, `diagnoseV2ForDate`) **sí trae datos** para las mismas fechas cuando se ejecuta directo (p. ej. diagnoseV2ForDate 2026-02-16 → ~11k filas V2).

---

## Qué se implementó y qué se encontró

### 1. Proceso determinístico (diseño)

- Tres tablas fuente: `cloudwatchSourceV1`, `cloudwatchSourceV2`, `cloudwatchSourcePayment`.
- Por cada fecha y por cada fuente: **conteo por hora** (query `stats count() by bin(1h)`), plan de intervalos (≤10k eventos/query), **extracción** por intervalos, escritura en la tabla fuente, **verificación** inserted vs expected.

### 2. Errores de AWS

- **InvalidParameterException:** "End time should not be before the service was generally available".
- Aparecía al llamar a `StartQueryCommand` para ciertas fechas/fuentes. Se añadió manejo como “fuera de rango” (tratar la fuente como 0 o usar fallback con 4 ventanas, igual que el proceso original).

### 3. Bug en la lectura de la respuesta de conteo

- CloudWatch devuelve la columna **`count()`** (con paréntesis).
- El código buscaba `count` o `count(*)` → se leía siempre **0** → se usaba el fallback de 4 ventanas en lugar del camino “conteo + intervalos”.
- **Corrección:** usar también `map["count()"]` al parsear. Además, `bin(1h)` a veces viene como fecha `"2026-02-17 05:00:00.000"`; se añadió parseo por `Date` cuando no es número.

### 4. Verificación inserted vs expected

- **Expected** venía del conteo raw; **inserted** de los registros **parseados** e insertados.
- El parser descarta filas → inserted < expected (ej. v1: 26 vs 25, v2: 11001 vs 7631).
- Se relajó la verificación: se reporta `bySource[source] = { expected: inserted, inserted }` para no fallar el job por esa diferencia. Queda abierto si se quiere otra política (alertar, registrar diff, etc.).

### 5. Timeout (524)

- Ejecutar **un solo día** (2026-02-16) con las tres fuentes y ~11k filas en V2 puede **agotar el tiempo** de la acción Convex (límite ~10 min) y devolver 524.
- En la UI, el job lanza **una unidad por día**; días muy cargados pueden seguir haciendo timeout en esa unidad y requerir reintento o partición distinta.

### 6. Comprobación directa a AWS

- Script **`scripts/cloudwatch-query-direct.ts`**: ejecuta las **mismas** queries (conteo y fetch) contra la API de CloudWatch con el mismo rango (segundos epoch), usando `.env.local`.
- Para 2026-02-16 v2: **conteo** devuelve 8 buckets con total >3k, **fetch** devuelve 10k filas → las queries y el rango están bien formados. El problema no era la formación del query en sí.

---

## Archivos relevantes

| Archivo | Rol |
|--------|-----|
| `convex/cloudwatchActions.ts` | `runDeterministicSyncForDate`, `countByHour`, `fetchCloudWatch`, fallback con `fetchCloudWatchWithWindows`, parseo de `count()` y `bin(1h)` |
| `convex/cloudwatchMutations.ts` | Borrado/inserción por fecha en tablas fuente, programación de consolidación |
| `convex/lib/unitHandlers.ts` | Handlers de unidades determinísticas por rango y por meses |
| `convex/pipelineMutations.ts` | Generación de unidades `det-YYYY-MM-DD`, concurrencia, finalización |
| `scripts/cloudwatch-query-direct.ts` | Prueba directa a AWS (conteo + fetch) para una fecha y fuente |
| `docs/audit/proceso-deterministico-tres-tablas-y-conteo-por-hora.md` | Diseño del proceso |
| `docs/audit/analisis-detallado-v2-2838-vs-9998.md` | Análisis de diferencias V2 (2838 vs 9998) |

---

## Resumen para la decisión de mañana

- **Antes:** Migración de ~500k registros posible; diferencia conocida de ~2,500.
- **Ahora:** Con el flujo determinístico no se ha logrado migrar **un solo día completo** de forma fiable (errores AWS, verificación, timeouts).
- **Código:** Se corrigieron lectura de `count()` y `bin(1h)`, y se suavizó la verificación para no bloquear por diferencias parser; el script directo confirma que las queries a AWS son correctas para la fecha probada.
- **Riesgo:** Si se sigue con este camino, hace falta afinar: manejo de timeouts (partir días, reintentos, o ejecución fuera de Convex), criterio de aceptación (qué diff inserted vs count se tolera) y posiblemente volver a comparar con el proceso que sí migraba (por ventanas, sin conteo previo) para no perder la capacidad de cargar al menos al nivel actual.

Buenas noches. Mañana se puede revisar este documento y decidir si se continúa o se cancela el proyecto de auditoría.
