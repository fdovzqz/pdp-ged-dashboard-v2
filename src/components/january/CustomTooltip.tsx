"use client";

import type { TooltipProps } from "recharts";

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export interface CustomTooltipProps extends TooltipProps<number, string> {
  format?: "number" | "currency" | "mixed";
  labels?: Record<string, string>;
  formatMap?: Record<string, "number" | "currency">;
}

export const CustomTooltip = ({
  active,
  payload,
  label,
  format = "number",
  labels,
  formatMap,
}: CustomTooltipProps): React.ReactElement | null => {
  if (!active || !payload || payload.length === 0) return null;

  const getFmt = (dataKey: string) => {
    if (formatMap?.[dataKey]) {
      return formatMap[dataKey] === "currency" ? formatCurrency : formatNumber;
    }
    if (format === "mixed") {
      return dataKey === "dailyAmount" ? formatCurrency : formatNumber;
    }
    return format === "currency" ? formatCurrency : formatNumber;
  };

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/95 backdrop-blur-sm px-4 py-3 shadow-xl">
      <p className="text-sm font-medium text-slate-300 mb-2">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div
            key={entry.dataKey}
            className="flex items-center gap-3 justify-between"
          >
            <span
              className="text-xs"
              style={{ color: entry.color ?? "#94a3b8" }}
            >
              {labels?.[String(entry.dataKey)] ?? String(entry.dataKey)}:
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {getFmt(String(entry.dataKey))(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
