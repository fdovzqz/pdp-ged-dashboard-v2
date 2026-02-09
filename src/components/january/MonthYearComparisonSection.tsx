"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { BarChart3, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CustomTooltip } from "./CustomTooltip";
const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

const YEAR_COLORS: Record<string, string> = {
  "2024": "#94a3b8",
  "2025": "#818cf8",
  "2026": "#34d399",
};

export interface MonthYearComparisonSectionProps {
  month: number;
  monthLabel: string;
  lastAvailableDay: number;
  /** Totales con corte hasta lastAvailableDay por año */
  totalsByYear: Record<string, number>;
  amountsByYear: Record<string, { events: number; totalAmount: number }>;
  dailyAverages: Record<string, number>;
  growthMetrics?: {
    growth24vs25: number;
    growth25vs26: number;
    growth24vs26: number;
  };
}

export const MonthYearComparisonSection = memo(({
  month,
  monthLabel,
  lastAvailableDay,
  totalsByYear,
  amountsByYear,
  dailyAverages,
  growthMetrics,
}: MonthYearComparisonSectionProps): React.ReactElement => {
  const years = ["2024", "2025", "2026"] as const;

  const barData = years.map((y) => {
    const events = totalsByYear[y] ?? 0;
    const amt = amountsByYear[y];
    const totalAmount = amt?.totalAmount ?? 0;
    const ticketPromedio = events > 0 ? Math.round(totalAmount / events) : 0;
    const avgDaily = dailyAverages[y] ?? 0;
    return {
      year: y,
      pagos: events,
      recaudacion: totalAmount,
      ticketPromedio,
      avgDaily,
      color: YEAR_COLORS[y],
    };
  });

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="glass-card rounded-2xl p-6 min-w-0"
    >
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="w-5 h-5 text-indigo-400" />
        <h3 className="text-lg font-semibold font-display">
          Mismo mes vs. años anteriores
        </h3>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Comparativa de {monthLabel} hasta día {lastAvailableDay} en 2024, 2025 y 2026
      </p>

      {/* Tabla comparativa */}
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left py-3 px-3 text-slate-400 font-medium">
                Métrica
              </th>
              {years.map((y) => (
                <th
                  key={y}
                  className="text-right py-3 px-3 font-medium"
                  style={{ color: YEAR_COLORS[y] }}
                >
                  {y}
                </th>
              ))}
              <th className="text-right py-3 px-3 text-slate-400 font-medium text-xs">
                Δ 24→26
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-800/50">
              <td className="py-2.5 px-3 text-slate-300">Pagos</td>
              {years.map((y) => (
                <td
                  key={y}
                  className="text-right py-2.5 px-3 tabular-nums font-semibold"
                  style={{ color: YEAR_COLORS[y] }}
                >
                  {formatNumber(totalsByYear[y] ?? 0)}
                </td>
              ))}
              <td className="text-right py-2.5 px-3">
                {growthMetrics && (
                  <GrowthBadge value={growthMetrics.growth24vs26} />
                )}
              </td>
            </tr>
            <tr className="border-b border-slate-800/50">
              <td className="py-2.5 px-3 text-slate-300">Recaudación</td>
              {years.map((y) => {
                const amt = amountsByYear[y]?.totalAmount ?? 0;
                return (
                  <td
                    key={y}
                    className="text-right py-2.5 px-3 tabular-nums text-amber-400/90"
                  >
                    {formatCurrency(amt)}
                  </td>
                );
              })}
              <td className="text-right py-2.5 px-3">—</td>
            </tr>
            <tr className="border-b border-slate-800/50">
              <td className="py-2.5 px-3 text-slate-300">Prom. diario</td>
              {years.map((y) => (
                <td
                  key={y}
                  className="text-right py-2.5 px-3 tabular-nums text-slate-300"
                >
                  {formatNumber(dailyAverages[y] ?? 0)}
                </td>
              ))}
              <td className="text-right py-2.5 px-3">—</td>
            </tr>
            <tr>
              <td className="py-2.5 px-3 text-slate-300">Ticket promedio</td>
              {years.map((y) => {
                const amt = amountsByYear[y];
                const events = totalsByYear[y] ?? 0;
                const ticket =
                  events > 0 && amt
                    ? Math.round(amt.totalAmount / events)
                    : 0;
                return (
                  <td
                    key={y}
                    className="text-right py-2.5 px-3 tabular-nums text-emerald-400/90"
                  >
                    {formatCurrency(ticket)}
                  </td>
                );
              })}
              <td className="text-right py-2.5 px-3">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Crecimiento interanual */}
      {growthMetrics && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-3">
            <p className="text-xs text-slate-400 mb-1">2024 → 2025</p>
            <GrowthBadge value={growthMetrics.growth24vs25} size="lg" />
          </div>
          <div className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-3">
            <p className="text-xs text-slate-400 mb-1">2025 → 2026</p>
            <GrowthBadge value={growthMetrics.growth25vs26} size="lg" />
          </div>
          <div className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-3">
            <p className="text-xs text-slate-400 mb-1">2024 → 2026</p>
            <GrowthBadge value={growthMetrics.growth24vs26} size="lg" />
          </div>
        </div>
      )}

      {/* Gráfica de barras */}
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={barData}
            margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
            />
            <XAxis
              dataKey="year"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(v) => formatNumber(v)}
            />
            <Tooltip
              content={
                <CustomTooltip
                  labels={{
                    pagos: "Pagos",
                    recaudacion: "Recaudación",
                    ticketPromedio: "Ticket prom.",
                    avgDaily: "Prom. diario",
                  }}
                  formatMap={{
                    pagos: "number",
                    recaudacion: "currency",
                    ticketPromedio: "currency",
                    avgDaily: "number",
                  }}
                />
              }
            />
            <Bar
              dataKey="pagos"
              fill="#34d399"
              radius={[2, 2, 0, 0]}
              name="Pagos"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
});

MonthYearComparisonSection.displayName = "MonthYearComparisonSection";

function GrowthBadge({
  value,
  size = "sm",
}: {
  value: number;
  size?: "sm" | "lg";
}): React.ReactElement {
  const isPositive = value >= 0;
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;
  const colorClass = isPositive ? "text-emerald-400" : "text-rose-400";
  const sizeClass = size === "lg" ? "text-lg font-bold" : "text-xs font-semibold";

  return (
    <span className={`inline-flex items-center gap-0.5 ${colorClass} ${sizeClass}`}>
      <Icon className="w-3.5 h-3.5" />
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}
