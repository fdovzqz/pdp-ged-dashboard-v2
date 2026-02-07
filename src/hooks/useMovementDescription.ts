"use client";

import { useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";

/**
 * Devuelve getMovementDescription usando solo la tabla Convex (movementCodes).
 * Sin fallbacks hardcodeados: todo se gestiona desde la tabla.
 */
export function useGetMovementDescription(): (codigo: string) => string {
  const config = useQuery(api.movementCodes.getMovementCodesConfig);

  return useCallback(
    (codigo: string): string => {
      const trimmed = String(codigo ?? "").trim();
      if (!trimmed) return "(sin tipo)";

      if (!config) return trimmed.toUpperCase();

      const upper = trimmed.toUpperCase();
      const resolved = config.aliases[upper] ?? upper;
      const desc = config.descriptions[resolved];
      return desc ? desc.toUpperCase() : resolved;
    },
    [config]
  );
}
