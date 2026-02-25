"use client";

import { useEffect } from "react";

/**
 * Parche para el bug de Next.js 16: performance.measure() lanza
 * "cannot have a negative time stamp" en redirects/navegación (issue #86060).
 * Ignoramos ese error para no romper la consola.
 */
export function PerformanceMeasurePatch(): null {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const perf = window.performance;
    if (!perf || typeof perf.measure !== "function" || (perf as { __measurePatched?: boolean }).__measurePatched) {
      return;
    }
    const original = perf.measure.bind(perf);
    perf.measure = function patchedMeasure(
      name: string,
      startOrMeasureOptions?: string | PerformanceMeasureOptions,
      endMark?: string
    ): PerformanceMeasure {
      try {
        return original(name, startOrMeasureOptions as string, endMark);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("negative time stamp")) return undefined as unknown as PerformanceMeasure;
        throw err;
      }
    };
    (perf as { __measurePatched?: boolean }).__measurePatched = true;
  }, []);
  return null;
}
