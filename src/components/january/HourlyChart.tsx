"use client";

import { useMemo, memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
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

export interface SelectedDayData {
  day: number;
  hourly: Array<{ hour: number; events: number; totalAmount?: number }>;
  pagos: number;
  totalAmount: number;
  ticketPromedio: number;
}

export type CalendarMode = "events" | "amount";

export interface HourlyChartProps {
  weekdayData: Array<{ hour: number; value: number }> | undefined;
  weekendData?: Array<{ hour: number; value: number }>;
  selectedDayData: SelectedDayData | null;
  onClearSelection: () => void;
  calendarMode?: CalendarMode;
}

const DISPLAY_DURATION_MS = 60_000;

export const HourlyChart = memo(({
  weekdayData,
  weekendData,
  selectedDayData,
  onClearSelection,
  calendarMode = "events",
}: HourlyChartProps): React.ReactElement => {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // Countdown timer resets when selection changes; setState in effect is intentional
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- Countdown timer must reset when selection changes */
    if (!selectedDayData) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(Math.floor(DISPLAY_DURATION_MS / 1000));
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          onClearSelection();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [selectedDayData, onClearSelection]);

  const showDayBars = selectedDayData && selectedDayData.hourly.length > 0;

  const { mergedData, mesStats } = useMemo(() => {
    if (!weekdayData) return { mergedData: [], mesStats: null };
    const data = weekdayData.map((wd, i) => ({
      hour: wd.hour,
      "L-V": wd.value,
      "S-D": (weekendData?.[i]?.value ?? 0),
      Ambos: wd.value + (weekendData?.[i]?.value ?? 0),
    }));
    const totalLV = data.reduce((s, d) => s + d["L-V"], 0);
    const totalSD = data.reduce((s, d) => s + d["S-D"], 0);
    const peak = data.length > 0
      ? data.reduce((best, d) => (d.Ambos > best.Ambos ? d : best), data[0])
      : null;
    const mesStats = { totalLV, totalSD, peakHour: peak?.hour ?? 0 };
    return { mergedData: data, mesStats };
  }, [weekdayData, weekendData]);

  if (weekdayData === undefined) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/40 backdrop-blur-sm rounded-3xl border border-slate-700/50 p-6 min-w-0"
      >
        <div className="flex items-center justify-center min-h-[280px]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <p className="text-slate-400 text-sm">Cargando distribución horaria...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="glass-card rounded-2xl p-6 min-w-0 overflow-hidden flex flex-col min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 shrink-0">
        <h3 className="text-lg font-semibold font-display">
          {showDayBars
            ? `Día ${selectedDayData?.day ?? ""} de Enero - Distribución horaria`
            : "Distribución horaria del mes"}
        </h3>
        <div className="flex items-center gap-4 flex-wrap">
          {showDayBars && selectedDayData ? (
            <>
              <span className="text-xs text-slate-400">
                Pagos <strong className="text-emerald-400">{formatNumber(selectedDayData.pagos)}</strong>
              </span>
              <span className="text-xs text-slate-400">
                Ingresos <strong className="text-amber-400">{formatCurrency(selectedDayData.totalAmount)}</strong>
              </span>
              <span className="text-xs text-slate-400">
                Ticket <strong>{formatCurrency(selectedDayData.ticketPromedio)}</strong>
              </span>
              {remainingSeconds !== null && (
                <span className="text-xs text-slate-500 tabular-nums">
                  Volverá en {remainingSeconds}s
                </span>
              )}
            </>
          ) : mesStats ? (
            <>
              <span className="text-xs text-slate-400">
                L-V <strong className="text-emerald-400">{formatNumber(mesStats.totalLV)}</strong>
              </span>
              <span className="text-xs text-slate-400">
                S-D <strong className="text-violet-400">{formatNumber(mesStats.totalSD)}</strong>
              </span>
              <span className="text-xs text-slate-400">
                Pico <strong>{mesStats.peakHour}:00</strong>
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          {showDayBars && selectedDayData ? (
            <BarChart
              data={selectedDayData.hourly.map((h) => ({
                ...h,
                totalAmount: h.totalAmount ?? 0,
              }))}
              margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="hour"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={(h) => `${h}:00`}
              />
              <YAxis
                tick={{ fill: calendarMode === "amount" ? "#f59e0b" : "#94a3b8", fontSize: 12 }}
                tickFormatter={
                  calendarMode === "amount"
                    ? (v: number) =>
                        v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}k`
                    : undefined
                }
              />
              <Tooltip
                content={
                  <CustomTooltip
                    format={calendarMode === "amount" ? "currency" : "number"}
                    labels={
                      calendarMode === "amount"
                        ? { totalAmount: "Recaudación" }
                        : { events: "Pagos" }
                    }
                  />
                }
                labelFormatter={(h) => `Hora ${h}:00`}
              />
              <Bar
                dataKey={calendarMode === "amount" ? "totalAmount" : "events"}
                fill={calendarMode === "amount" ? "#f59e0b" : "#34d399"}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          ) : (
            <AreaChart data={mergedData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="hour"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={(h) => `${h}:00`}
              />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <Tooltip
                content={
                  <CustomTooltip
                    labels={{ Ambos: "Ambos", "L-V": "L-V", "S-D": "S-D" }}
                  />
                }
                labelFormatter={(h) => `Hora ${h}:00`}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="Ambos"
                stroke="#64748b"
                fill="#64748b"
                fillOpacity={0.15}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="L-V"
                stroke="#34d399"
                fill="#34d399"
                fillOpacity={0.2}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="S-D"
                stroke="#a78bfa"
                fill="#a78bfa"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
});

HourlyChart.displayName = "HourlyChart";
