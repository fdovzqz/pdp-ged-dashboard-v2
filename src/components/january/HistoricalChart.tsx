"use client";

import { useMemo, useState, memo } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { CustomTooltip } from "./CustomTooltip";

const COLOR_PAGOS = "#34d399";
const COLOR_MONTO = "#f59e0b";

export interface HistoricalChartProps {
  data: Array<{ day: number; "2026": number }> | undefined;
  dailyAmountData?: Array<{ day: number; totalAmount: number }>;
  dailyAverage: number;
  dailyAverageAmount?: number;
  onDaySelect?: (day: number) => void;
}

export const HistoricalChart = memo(({
  data,
  dailyAmountData,
  dailyAverage,
  dailyAverageAmount,
  onDaySelect,
}: HistoricalChartProps): React.ReactElement => {
  const [mode, setMode] = useState<"daily" | "cumulative">("daily");

  const chartData = useMemo(() => {
    if (!data) return [];
    const amountByDay = new Map(
      (dailyAmountData ?? []).map((d) => [d.day, d.totalAmount])
    );
    const mapped = data.map((row) => ({
      day: row.day,
      value: row["2026"] ?? 0,
      dailyAmount: amountByDay.get(row.day) ?? 0,
    }));
    if (mode === "daily") return mapped;
    let accEvents = 0;
    let accAmount = 0;
    return mapped.map((row) => {
      accEvents += row.value;
      accAmount += row.dailyAmount;
      return { day: row.day, value: accEvents, dailyAmount: accAmount };
    });
  }, [data, dailyAmountData, mode]);

  if (data === undefined) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/40 backdrop-blur-sm rounded-3xl border border-slate-700/50 p-6 min-w-0"
      >
        <div className="flex items-center justify-center min-h-[320px]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <p className="text-slate-400 text-sm">Cargando datos históricos...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  const hasAmounts = chartData.some((d) => d.dailyAmount > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="glass-card rounded-2xl p-6 min-w-0 overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h3 className="text-lg font-semibold font-display">Tendencia diaria</h3>
        <div className="flex gap-2">
          {(["daily", "cumulative"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                mode === m
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-slate-800/50 text-slate-400 hover:text-slate-300"
              }`}
            >
              {m === "daily" ? "Diario" : "Acumulado"}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          {mode === "daily" ? (
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis
                yAxisId="left"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                label={{ value: "Pagos", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }}
              />
              {hasAmounts && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#f59e0b", fontSize: 12 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  label={{ value: "MXN", angle: 90, position: "insideRight", fill: "#f59e0b", fontSize: 11 }}
                />
              )}
              <Tooltip
                content={
                  <CustomTooltip
                    labels={{ value: "Pagos", dailyAmount: "Monto (MXN)" }}
                    format="mixed"
                  />
                }
              />
              {dailyAverage > 0 && (
                <ReferenceLine
                  yAxisId="left"
                  y={dailyAverage}
                  stroke="#94a3b8"
                  strokeDasharray="5 5"
                  label={{
                    value: `Prom: ${dailyAverage.toLocaleString("es-MX")}`,
                    position: "insideTopRight",
                    fontSize: 11,
                    fill: "#94a3b8",
                  }}
                />
              )}
              {hasAmounts && dailyAverageAmount !== undefined && dailyAverageAmount > 0 && (
                <ReferenceLine
                  yAxisId="right"
                  y={dailyAverageAmount}
                  stroke="#f59e0b"
                  strokeDasharray="5 5"
                  strokeOpacity={0.8}
                  label={{
                    value: `Prom $: $${(dailyAverageAmount / 1000).toFixed(0)}k`,
                    position: "insideBottomRight",
                    fontSize: 11,
                    fill: "#f59e0b",
                  }}
                />
              )}
              <Line
                type="monotone"
                yAxisId="left"
                dataKey="value"
                stroke={COLOR_PAGOS}
                strokeWidth={2.5}
                dot={false}
                activeDot={{
                  r: 6,
                  cursor: "pointer",
                  fill: COLOR_PAGOS,
                  stroke: "#fff",
                  strokeWidth: 2,
                  onClick: (e: React.MouseEvent) => {
                    const target = e.target as SVGElement;
                    const cx = target.getAttribute("cx");
                    if (!onDaySelect || !cx) return;
                    const chartWidth = target.closest("svg")?.clientWidth ?? 1;
                    const padding = 60;
                    const ratio = (parseFloat(cx) - padding) / (chartWidth - 2 * padding);
                    const dayIndex = Math.round(ratio * (chartData.length - 1));
                    const point = chartData[dayIndex];
                    if (point) onDaySelect(point.day);
                  },
                }}
              />
              {hasAmounts && (
                <Line
                  type="monotone"
                  yAxisId="right"
                  dataKey="dailyAmount"
                  stroke={COLOR_MONTO}
                  strokeWidth={2}
                  dot={false}
                  name="Monto"
                />
              )}
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad2026" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              {hasAmounts && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#f59e0b", fontSize: 12 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
              )}
              <Tooltip
                content={
                  <CustomTooltip
                    format="mixed"
                    formatMap={{ value: "number", dailyAmount: "currency" }}
                    labels={{ value: "Acum. pagos", dailyAmount: "Acum. monto (MXN)" }}
                  />
                }
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="value"
                stroke="#10b981"
                fill="url(#grad2026)"
                strokeWidth={2.5}
              />
              {hasAmounts && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="dailyAmount"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Acum. monto"
                />
              )}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
});

HistoricalChart.displayName = "HistoricalChart";
