"use client";

import { useMemo, useState, useCallback, useRef, memo } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMonthShortName } from "@/lib/constants";

export interface HeatmapCell {
  day: number;
  dayName: string;
  week: number;
  value: number;
  amount?: number;
  year: number;
}

const DAY_LETTERS = ["D", "L", "M", "M", "J", "V", "S"] as const;

function buildCalendarGrid(
  data: HeatmapCell[],
  year: number,
  month: number
): (HeatmapCell | null)[][] {
  const byDay = new Map(data.map((d) => [d.day, d]));
  const month0 = month - 1; // 0-indexed para Date
  const firstDay = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const grid: (HeatmapCell | null)[][] = [];
  let row: (HeatmapCell | null)[] = Array(7).fill(null);
  for (let i = 0; i < firstDay; i++) row[i] = null;
  for (let d = 1; d <= daysInMonth; d++) {
    const col = (firstDay + d - 1) % 7;
    row[col] = byDay.get(d) ?? {
      day: d,
      dayName: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][new Date(year, month0, d).getDay()],
      week: Math.ceil(d / 7),
      value: 0,
      amount: 0,
      year,
    };
    if (col === 6 || d === daysInMonth) {
      grid.push([...row]);
      row = Array(7).fill(null);
    }
  }
  if (row.some((c) => c !== null)) grid.push(row);
  return grid;
}

export interface HeatmapChartProps {
  data: HeatmapCell[] | undefined;
  selectedDay: number | null;
  onDayClick: (day: number, year: number) => void;
  mode?: "events" | "amount";
  onModeChange?: (mode: "events" | "amount") => void;
  month: number;
  year: number;
}

interface TooltipState {
  day: number;
  value: number;
  amount: number;
  dayName: string;
  x: number;
  y: number;
}

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

/** Escala: amarillos tenues → naranjas → rojos → morados (misma para eventos y montos) */
const getIntensityColor = (value: number, maxValue: number): string => {
  if (value <= 0) return "bg-slate-800/50";
  const intensity = value / maxValue;
  if (intensity < 0.15) return "bg-yellow-100/90";
  if (intensity < 0.30) return "bg-yellow-300/90";
  if (intensity < 0.45) return "bg-amber-400";
  if (intensity < 0.60) return "bg-orange-500";
  if (intensity < 0.75) return "bg-red-500";
  if (intensity < 0.90) return "bg-red-600";
  return "bg-violet-500";
};

const getTextColor = (value: number, maxValue: number): string => {
  if (value <= 0) return "text-slate-500";
  const intensity = value / maxValue;
  return intensity < 0.45 ? "text-slate-900" : "text-white";
};

export const HeatmapChart = memo(({
  data,
  selectedDay,
  onDayClick,
  mode: controlledMode,
  onModeChange,
  month,
  year,
}: HeatmapChartProps): React.ReactElement => {
  const [internalMode, setInternalMode] = useState<"events" | "amount">("events");
  const mode = controlledMode ?? internalMode;
  const setMode = onModeChange ?? setInternalMode;
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const maxVal = useMemo(() => {
    if (!data) return 1;
    return Math.max(
      ...data.map((d) => (mode === "amount" ? (d.amount ?? 0) : d.value)),
      1
    );
  }, [data, mode]);

  const grid = useMemo(
    () => (data ? buildCalendarGrid(data, year, month) : []),
    [data, year, month]
  );

  const stats = useMemo(() => {
    if (!data || data.length === 0) return { min: 0, max: 0, avg: 0 };
    const values = data.map((d) =>
      mode === "amount" ? (d.amount ?? 0) : d.value
    ).filter((v) => v > 0);
    if (values.length === 0) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
    };
  }, [data, mode]);

  const handleMouseEnter = useCallback(
    (cell: HeatmapCell, event: React.MouseEvent) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const container = containerRef.current?.getBoundingClientRect();
      if (!container) return;

      let x = rect.left - container.left + rect.width / 2;
      const y = rect.top - container.top - 8;

      // Keep tooltip in bounds
      if (x < 80) x = 80;
      if (x > container.width - 80) x = container.width - 80;

      setTooltip({
        day: cell.day,
        value: cell.value,
        amount: cell.amount ?? 0,
        dayName: cell.dayName,
        x,
        y,
      });
    },
    []
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const hasAmountData = data?.some((d) => (d.amount ?? 0) > 0) ?? false;

  if (data === undefined) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/40 backdrop-blur-sm rounded-3xl border border-slate-700/50 p-6 min-w-0"
      >
        <div className="flex items-center justify-center min-h-[240px]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <p className="text-slate-400 text-sm">Cargando heatmap...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="glass-card rounded-2xl p-6 min-w-0 overflow-hidden heatmap-container"
      ref={containerRef}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold font-display">
          Calendario {getMonthShortName(month)}
        </h3>
        {hasAmountData && (
          <div className="flex gap-1">
            {(["events", "amount"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                  mode === m
                    ? m === "events"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    : "bg-slate-800/50 text-slate-400 hover:text-slate-300"
                )}
              >
                {m === "events" ? "Volumen" : "Recaudación"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative w-full min-w-0">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 w-full auto-rows-fr">
          {DAY_LETTERS.map((letter, i) => (
            <div
              key={i}
              className="flex items-center justify-center py-0.5 text-[10px] sm:text-xs font-medium text-slate-500"
            >
              {letter}
            </div>
          ))}
          {grid.flatMap((row, rowIdx) =>
            row.map((cell, colIdx) => {
              if (!cell) {
                return (
                  <div
                    key={`e-${rowIdx}-${colIdx}`}
                    className="aspect-square min-w-0 rounded-lg bg-transparent"
                  />
                );
              }
              const cellValue =
                mode === "amount" ? (cell.amount ?? 0) : cell.value;
              const isSelected = selectedDay === cell.day;
              return (
                <button
                  key={cell.day}
                  type="button"
                  onClick={() => onDayClick(cell.day, cell.year)}
                  onMouseEnter={(e) => handleMouseEnter(cell, e)}
                  onMouseLeave={handleMouseLeave}
                  className={cn(
                    "aspect-square min-w-0 rounded-lg text-xs sm:text-sm font-semibold transition-all hover:ring-2 hover:ring-violet-400/50 flex items-center justify-center",
                    getIntensityColor(cellValue, maxVal),
                    getTextColor(cellValue, maxVal),
                    isSelected && "ring-2 ring-violet-400 shadow-lg shadow-violet-500/30"
                  )}
                >
                  {cell.day}
                </button>
              );
            })
          )}
        </div>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="absolute z-50 pointer-events-none transform -translate-x-1/2 -translate-y-full"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/95 backdrop-blur-sm px-3 py-2 shadow-xl text-center">
              <p className="text-xs font-medium text-slate-300">
                {tooltip.dayName} {tooltip.day} {getMonthShortName(month)}
              </p>
              <p className="text-sm font-bold tabular-nums text-white">
                {formatNumber(tooltip.value)} pagos
              </p>
              {tooltip.amount > 0 && (
                <p className="text-xs tabular-nums text-amber-400">
                  {formatCurrency(tooltip.amount)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Índice de colores */}
      <div className="mt-4 pt-3 border-t border-slate-700/30">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">
          Escala de intensidad
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
            {mode === "amount" ? formatCurrency(stats.min) : formatNumber(stats.min)}
          </span>
          <div
            className="flex-1 h-3 rounded-full overflow-hidden"
            style={{
              background: "linear-gradient(to right, #fef9c3 0%, #fde047 15%, #fbbf24 30%, #f97316 45%, #ef4444 60%, #dc2626 75%, #8b5cf6 100%)",
            }}
          />
          <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
            {mode === "amount" ? formatCurrency(stats.max) : formatNumber(stats.max)}
          </span>
        </div>
      </div>

      {/* Mini stats */}
      <div className="flex items-center justify-between mt-3 pt-2">
        <div className="flex gap-4">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Mín</p>
            <p className="text-sm font-semibold tabular-nums">
              {mode === "amount" ? formatCurrency(stats.min) : formatNumber(stats.min)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Prom</p>
            <p className="text-sm font-semibold tabular-nums">
              {mode === "amount" ? formatCurrency(stats.avg) : formatNumber(stats.avg)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Máx</p>
            <p className="text-sm font-semibold tabular-nums">
              {mode === "amount" ? formatCurrency(stats.max) : formatNumber(stats.max)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Clic para ver detalle en gráfica
        </p>
      </div>
    </motion.div>
  );
});

HeatmapChart.displayName = "HeatmapChart";
