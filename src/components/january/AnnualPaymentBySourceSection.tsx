"use client";

import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export interface AnnualSourceRow {
  fuente: string;
  label: string;
  count: number;
  monto: number;
  pctCount: number;
  pctMonto: number;
  ticketPromedio: number;
}

export interface AnnualPaymentBySourceData {
  byYear: Record<string, AnnualSourceRow[]>;
  totals: AnnualSourceRow[];
}

export interface AnnualPaymentBySourceSectionProps {
  data: AnnualPaymentBySourceData | null | undefined;
}

const FUENTE_COLORS: Record<string, string> = {
  EVO: "#34d399",
  DEC: "#60a5fa",
  CODI: "#a78bfa",
  MIT: "#f59e0b",
  NO_DEFINIDO: "#94a3b8",
};

const FUENTE_ORDER = ["EVO", "DEC", "CODI", "MIT", "NO_DEFINIDO"] as const;

type ViewMode = "volumen" | "monto";

const PieTooltipContent = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { name: string; count: number; monto: number; pct: number };
  }>;
}): React.ReactElement | null => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 shadow-xl min-w-[180px]">
      <p className="text-xs font-semibold text-slate-200 mb-1.5">{d.name}</p>
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Pagos</span>
          <span className="font-semibold tabular-nums text-slate-100">
            {formatNumber(d.count)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Monto</span>
          <span className="font-semibold tabular-nums text-slate-100">
            {formatCurrency(d.monto)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">%</span>
          <span className="font-semibold tabular-nums text-slate-100">
            {d.pct.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export const AnnualPaymentBySourceSection = memo(
  ({ data }: AnnualPaymentBySourceSectionProps): React.ReactElement => {
    const [viewMode, setViewMode] = useState<ViewMode>("volumen");

    const pieData = useMemo(() => {
      if (!data?.totals?.length) return [];
      return data.totals.map((s) => ({
        name: s.label,
        count: s.count,
        monto: s.monto,
        pct: viewMode === "volumen" ? s.pctCount : s.pctMonto,
        value: viewMode === "volumen" ? s.count : s.monto,
        color: FUENTE_COLORS[s.fuente] ?? "#94a3b8",
      }));
    }, [data, viewMode]);

    const stackedBarData = useMemo(() => {
      if (!data?.byYear) return [];
      return (["2024", "2025", "2026"] as const).map((year) => {
        const row: Record<string, string | number> = { year };
        const sources = data.byYear[year] ?? [];
        for (const s of sources) {
          row[s.fuente] = viewMode === "volumen" ? s.count : s.monto;
        }
        for (const f of FUENTE_ORDER) {
          if (row[f] === undefined) row[f] = 0;
        }
        return row;
      });
    }, [data, viewMode]);

    const hasAnyData = useMemo(() => {
      if (!data?.totals?.length) return false;
      return data.totals.some((s) => s.count > 0 || s.monto > 0);
    }, [data]);

    if (!data) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 min-w-0"
        >
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </motion.div>
      );
    }

    if (!hasAnyData) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 min-w-0"
        >
          <h3 className="text-lg font-semibold font-display mb-1">
            Pagos por tipo de fuente
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Desglose por fuente (DataMapping). Sin datos de fuente disponibles.
          </p>
          <div className="flex items-center justify-center min-h-[120px] text-slate-500 text-sm">
            Sin datos por fuente para el período seleccionado.
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="glass-card rounded-2xl p-6"
      >
        <h3 className="text-lg font-semibold font-display mb-1">
          Pagos por tipo de fuente
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Desglose por fuente (DataMapping). SPEI agrupado con SEI - No Definido.
        </p>

        {/* Toggle volumen / monto */}
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setViewMode("volumen")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              viewMode === "volumen"
                ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                : "text-slate-400 border-slate-600 hover:text-slate-200"
            )}
          >
            Volumen
          </button>
          <button
            type="button"
            onClick={() => setViewMode("monto")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
              viewMode === "monto"
                ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                : "text-slate-400 border-slate-600 hover:text-slate-200"
            )}
          >
            Monto
          </button>
        </div>

        {/* Cards por fuente */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          {data.totals.map((src, i) => {
            const color = FUENTE_COLORS[src.fuente] ?? "#94a3b8";
            return (
              <motion.div
                key={src.fuente}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i, duration: 0.5 }}
                className={cn(
                  "rounded-xl p-5 border",
                  src.fuente === "EVO" && "bg-emerald-500/10 border-emerald-500/20",
                  src.fuente === "DEC" && "bg-blue-500/10 border-blue-500/20",
                  src.fuente === "CODI" && "bg-violet-500/10 border-violet-500/20",
                  src.fuente === "MIT" && "bg-amber-500/10 border-amber-500/20",
                  src.fuente === "NO_DEFINIDO" && "bg-slate-500/10 border-slate-500/20"
                )}
                style={
                  !FUENTE_ORDER.includes(src.fuente as (typeof FUENTE_ORDER)[number])
                    ? {
                        borderColor: `${color}40`,
                        backgroundColor: `${color}15`,
                      }
                    : undefined
                }
              >
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-lg border"
                    style={{
                      backgroundColor: `${color}20`,
                      borderColor: `${color}40`,
                    }}
                  >
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color }}>
                      {src.label}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {formatNumber(src.count)} referencias
                    </p>
                  </div>
                </div>
                <p
                  className="text-3xl font-bold tabular-nums"
                  style={{ color: `${color}dd` }}
                >
                  {formatNumber(src.count)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {src.pctCount.toFixed(1)}% del volumen total
                </p>
                <div
                  className="mt-3 pt-3 space-y-1.5"
                  style={{ borderTop: `1px solid ${color}30` }}
                >
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Recaudación</span>
                    <span
                      className="font-semibold tabular-nums"
                      style={{ color: `${color}dd` }}
                    >
                      {formatCurrency(src.monto)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">% del ingreso</span>
                    <span className="font-semibold tabular-nums">
                      {src.pctMonto.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Ticket promedio</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(src.ticketPromedio)}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Donut + Stacked bar */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltipContent />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stackedBarData}
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
                  tickFormatter={
                    viewMode === "monto"
                      ? (v) =>
                          v >= 1_000_000
                            ? `$${(v / 1_000_000).toFixed(1)}M`
                            : v >= 1_000
                              ? `$${(v / 1_000).toFixed(0)}k`
                              : String(v)
                      : formatNumber
                  }
                />
                <Tooltip
                  formatter={(value: number) =>
                    viewMode === "monto"
                      ? formatCurrency(value)
                      : formatNumber(value)
                  }
                  contentStyle={{
                    backgroundColor: "rgba(15, 23, 42, 0.95)",
                    border: "1px solid rgba(148, 163, 184, 0.3)",
                    borderRadius: "8px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                {FUENTE_ORDER.map((fuente) => {
                  const label =
                    data.totals.find((s) => s.fuente === fuente)?.label ?? fuente;
                  return (
                    <Bar
                      key={fuente}
                      dataKey={fuente}
                      stackId="1"
                      fill={FUENTE_COLORS[fuente]}
                      radius={[0, 0, 0, 0]}
                      name={label}
                    />
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>
    );
  }
);

AnnualPaymentBySourceSection.displayName = "AnnualPaymentBySourceSection";
