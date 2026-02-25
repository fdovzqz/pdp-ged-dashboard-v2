# Sanitización ASCII para Convex

Convex rechaza caracteres no ASCII en:
- **Object keys** (nombres de campos): solo `\x20-\x7E`
- **Index values**: mismo criterio

## Capas de defensa implementadas

1. **`movementCodes.toAscii()`** (exportado)
   - Normaliza NFD, elimina diacríticos, elimina caracteres fuera de ASCII
   - Usado en toda la lógica de códigos

2. **`getMovementConfig`**
   - Todas las keys de `descriptions` y `aliases` pasan por `toAscii()`
   - Valores de aliases también sanitizados

3. **`normalizeWithConfig`**
   - Siempre devuelve `toAscii(result)` al final

4. **`januaryETL.buildJanuaryAggregates`**
   - Sanitiza config al recibirla: rebuild de `descriptions` y `aliases` con keys ASCII
   - `amountByMovementRecords`: cada `movimiento` pasa por `toAscii()`

5. **`batchInsertAmountByMovement`**
   - Sanitiza `movimiento` antes de insertar

## Si el error persiste

1. **Redeploy**: `npx convex deploy` para asegurar que el código actual está en producción
2. **Limpiar movementAliases**: Eliminar filas con variantes que tengan acentos y volver a sembrar
3. **Verificar Convex Dashboard**: Revisar que `movementCodes` y `movementAliases` no tengan caracteres con acentos en codigo/variante
