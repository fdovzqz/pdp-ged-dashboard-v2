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
} from "recharts";
import { Globe, Building2, ArrowRightLeft } from "lucide-react";
import { CustomTooltip } from "./CustomTooltip";
import { cn } from "@/lib/utils";

/* ──────── Formatters ──────── */
const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

/* ──────── Types ──────── */
interface ChannelData {
  count: number;
  monto: number;
  pctCount: number;
  pctMonto: number;
  ticketPromedio: number;
  label: string;
}

interface VentanillaData extends ChannelData {
  v1Count: number;
  v2Count: number;
  v1Monto: number;
  v2Monto: number;
}

interface DailyChannelEntry {
  date: string;
  evo: number;
  ventanilla: number;
  evoMonto: number;
  ventanillaMonto: number;
  total: number;
  totalMonto?: number;
}

export interface SourceData {
  fuente: string;
  label: string;
  count: number;
  monto: number;
  pctCount: number;
  pctMonto: number;
  ticketPromedio: number;
}

export interface PaymentChannelStats {
  evo: ChannelData;
  ventanilla: VentanillaData;
  totalCount: number;
  totalMonto: number;
  dailyByChannel: DailyChannelEntry[];
  /** Cards por fuente cuando viene de DataMapping (EVO, DEC, CODI, NO_DEFINIDO). */
  sources?: SourceData[];
}

export interface PaymentChannelsSectionProps {
  data: PaymentChannelStats | null | undefined;
}

type ViewMode = "volumen" | "monto";

/* ──────── Pie tooltip ──────── */
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

/* ──────── Constants ──────── */
const EVO_COLOR = "#34d399";
const VENTANILLA_COLOR = "#60a5fa";
const V1_COLOR = "#a78bfa";
const V2_COLOR = "#818cf8";

const FUENTE_COLORS: Record<string, string> = {
  EVO: "#34d399",
  DEC: "#60a5fa",
  CODI: "#a78bfa",
  NO_DEFINIDO: "#94a3b8",
};

/* ──────── Component ──────── */
export const PaymentChannelsSection = memo(
  ({ data }: PaymentChannelsSectionProps): React.ReactElement => {
    const [viewMode, setViewMode] = useState<ViewMode>("volumen");

    /* Donut data: volumen (count) or monto */
    const pieData = useMemo(() => {
      if (!data) return [];
      if (data.sources && data.sources.length > 0) {
        return data.sources.map((s) => ({
          name: s.label,
          count: s.count,
          monto: s.monto,
          pct: viewMode === "volumen" ? s.pctCount : s.pctMonto,
          value: viewMode === "volumen" ? s.count : s.monto,
          color: FUENTE_COLORS[s.fuente] ?? VENTANILLA_COLOR,
        }));
      }
      const { evo, ventanilla } = data;
      return [
        {
          name: "EVO · Pago en Línea",
          count: evo.count,
          monto: evo.monto,
          pct: viewMode === "volumen" ? evo.pctCount : evo.pctMonto,
          value: viewMode === "volumen" ? evo.count : evo.monto,
          color: EVO_COLOR,
        },
        {
          name: "Transferencias + Presencial con Edo. de Cuenta del Portal",
          count: ventanilla.count,
          monto: ventanilla.monto,
          pct: viewMode === "volumen" ? ventanilla.pctCount : ventanilla.pctMonto,
          value: viewMode === "volumen" ? ventanilla.count : ventanilla.monto,
          color: VENTANILLA_COLOR,
        },
      ];
    }, [data, viewMode]);

    /* Bar chart data: volumen or monto by day */
    const barData = useMemo(() => {
      if (!data) return [];
      const { dailyByChannel } = data;
      return dailyByChannel.map((d) => {
        const dayNum = parseInt(d.date.split("-")[2] ?? "0", 10);
        return {
          name: String(dayNum),
          evo: viewMode === "volumen" ? d.evo : d.evoMonto,
          ventanilla: viewMode === "volumen" ? d.ventanilla : d.ventanillaMonto,
        };
      });
    }, [data, viewMode]);

    if (!data) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 min-w-0"
        >
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="flex flex-col items-center gap-4">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 text-sm">
                Cargando canales de pago...
              </p>
            </div>
          </div>
        </motion.div>
      );
    }

    const { evo, ventanilla, totalCount, totalMonto } = data;

    return (
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.25 }}
        className="glass-card rounded-2xl p-6 min-w-0 overflow-hidden"
      >
        {/* Header + View mode control */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <ArrowRightLeft className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="text-lg font-semibold font-display">
                Fuentes de recaudación
              </h3>
              <p className="text-sm text-muted-foreground">
                Motor de pagos EVO (pago en línea) vs Transferencias + Presencial con Edo. de Cuenta del Portal
              </p>
            </div>
          </div>
          <div className="flex gap-1">
            {(["volumen", "monto"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  viewMode === m
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : "bg-slate-800/50 text-slate-400 hover:text-slate-300"
                )}
              >
                {m === "volumen" ? "Volumen" : "Monto"}
              </button>
            ))}
          </div>
        </div>

        {/* ──── Top: Cards por fuente (o EVO+Ventanilla) + Donut ──── */}
        <div
          className={cn(
            "grid gap-4 mb-6",
            data.sources && data.sources.length > 0
              ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
              : "grid-cols-1 lg:grid-cols-3"
          )}
        >
          {data.sources && data.sources.length > 0 ? (
            <>
              {data.sources.map((src, i) => {
                const color = FUENTE_COLORS[src.fuente] ?? VENTANILLA_COLOR;
                return (
                  <motion.div
                    key={src.fuente}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }}
                    className={cn(
                      "rounded-xl p-5 border",
                      src.fuente === "EVO" && "bg-emerald-500/10 border-emerald-500/20",
                      src.fuente === "DEC" && "bg-blue-500/10 border-blue-500/20",
                      src.fuente === "CODI" && "bg-violet-500/10 border-violet-500/20",
                      src.fuente === "NO_DEFINIDO" && "bg-slate-500/10 border-slate-500/20"
                    )}
                    style={!["EVO", "DEC", "CODI", "NO_DEFINIDO"].includes(src.fuente) ? { borderColor: `${color}40`, backgroundColor: `${color}15` } : undefined}
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
                        <p
                          className="text-sm font-semibold"
                          style={{ color }}
                        >
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
                        <span className="font-semibold tabular-nums" style={{ color: `${color}dd` }}>
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
            </>
          ) : (
            <>
              {/* EVO Card */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                    <Globe className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-400">
                      EVO · Motor de Pagos
                    </p>
                    <p className="text-[11px] text-slate-400">Pago por pago en línea</p>
                  </div>
                </div>
                <p className="text-3xl font-bold tabular-nums text-emerald-300">
                  {formatNumber(evo.count)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {evo.pctCount.toFixed(1)}% del volumen total
                </p>
                <div className="mt-3 pt-3 border-t border-emerald-500/20 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Recaudación</span>
                    <span className="font-semibold tabular-nums text-emerald-300">
                      {formatCurrency(evo.monto)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">% del ingreso</span>
                    <span className="font-semibold tabular-nums">
                      {evo.pctMonto.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Ticket promedio</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(evo.ticketPromedio)}
                    </span>
                  </div>
                </div>
              </motion.div>

              {/* Ventanilla Card */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35, duration: 0.5 }}
                className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/20 border border-blue-500/30">
                    <Building2 className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-blue-400">
                      Transferencias + Presencial con Edo. de Cuenta del Portal
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Bancos, cajas y transferencias
                    </p>
                  </div>
                </div>
                <p className="text-3xl font-bold tabular-nums text-blue-300">
                  {formatNumber(ventanilla.count)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {ventanilla.pctCount.toFixed(1)}% del volumen total
                </p>
                <div className="mt-3 pt-3 border-t border-blue-500/20 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Recaudación</span>
                    <span className="font-semibold tabular-nums text-blue-300">
                      {formatCurrency(ventanilla.monto)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">% del ingreso</span>
                    <span className="font-semibold tabular-nums">
                      {ventanilla.pctMonto.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Ticket promedio</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(ventanilla.ticketPromedio)}
                    </span>
                  </div>
                  {/* V1/V2 sub-breakdown */}
                  <div className="mt-2 pt-2 border-t border-blue-500/15 space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: V1_COLOR }}
                        />
                        V1
                      </span>
                      <span className="tabular-nums text-slate-400">
                        {formatNumber(ventanilla.v1Count)} pagos ·{" "}
                        {formatCurrency(ventanilla.v1Monto)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: V2_COLOR }}
                        />
                        V2
                      </span>
                      <span className="tabular-nums text-slate-400">
                        {formatNumber(ventanilla.v2Count)} pagos ·{" "}
                        {formatCurrency(ventanilla.v2Monto)}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </>
          )}

          {/* Donut Chart */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-5 flex flex-col items-center justify-center"
          >
            <p className="text-xs text-slate-400 font-medium mb-2">
              Distribución por {viewMode === "volumen" ? "volumen" : "monto"}
            </p>
            <div className="w-[180px] h-[180px] relative">
              <div className="absolute inset-0 z-10">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                    animationBegin={400}
                    animationDuration={800}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltipContent />} wrapperStyle={{ zIndex: 1000 }} />
                </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xl font-bold tabular-nums">
                  {viewMode === "volumen"
                    ? formatNumber(totalCount)
                    : formatCurrency(totalMonto)}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Total
                </span>
              </div>
            </div>
            {/* Legend */}
            <div className="flex flex-col gap-1.5 mt-3 w-full max-h-32 overflow-y-auto">
              {pieData.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-slate-300 flex-1 truncate">{entry.name}</span>
                  <span className="tabular-nums font-medium shrink-0">
                    {entry.pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* ──── Comparative bar: monto ──── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {/* Comparativa: volumen o monto */}
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/30 p-4">
            <p className="text-xs text-slate-400 font-medium mb-3">
              Comparativa por {viewMode === "volumen" ? "volumen" : "monto"}
            </p>
            <div className="space-y-4">
              {pieData.map((entry) => (
                <div key={entry.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-sm font-medium flex items-center gap-2"
                      style={{ color: entry.color }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: entry.color }}
                      />
                      {entry.name}
                    </span>
                    <span className="text-sm font-bold tabular-nums">
                      {viewMode === "volumen"
                        ? formatNumber(entry.count)
                        : formatCurrency(entry.monto)}
                    </span>
                  </div>
                  <div className="h-6 bg-slate-800/50 rounded-full overflow-hidden">
                    <motion.div
                      key={viewMode}
                      initial={{ width: 0 }}
                      animate={{
                        width:
                          viewMode === "volumen"
                            ? `${totalCount > 0 ? (entry.count / totalCount) * 100 : 0}%`
                            : `${totalMonto > 0 ? (entry.monto / totalMonto) * 100 : 0}%`,
                      }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                      className="h-full rounded-full flex items-center justify-end pr-2"
                      style={{ backgroundColor: `${entry.color}70` }}
                    >
                      <span className="text-[10px] font-bold text-white whitespace-nowrap">
                        {entry.pct.toFixed(1)}%
                      </span>
                    </motion.div>
                  </div>
                </div>
              ))}
            </div>
            {/* Total bar */}
            <div className="mt-4 pt-3 border-t border-slate-700/30 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {viewMode === "volumen" ? "Total pagos" : "Recaudación total"}
              </span>
              <span className="text-sm font-bold tabular-nums">
                {viewMode === "volumen"
                  ? formatNumber(totalCount)
                  : formatCurrency(totalMonto)}
              </span>
            </div>
          </div>

          {/* Summary insight card */}
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/30 p-4">
            <p className="text-xs text-slate-400 font-medium mb-3">
              Resumen ejecutivo
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center mt-0.5">
                  <Globe className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    <span className="text-emerald-400">
                      {evo.pctCount.toFixed(1)}%
                    </span>{" "}
                    de los pagos se reciben en línea
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatNumber(evo.count)} transacciones procesadas por el
                    motor de pagos EVO con un ticket promedio de{" "}
                    {formatCurrency(evo.ticketPromedio)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center mt-0.5">
                  <Building2 className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    <span className="text-blue-400">
                      {ventanilla.pctCount.toFixed(1)}%
                    </span>{" "}
                    se pagan en transferencias o presencial
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatNumber(ventanilla.count)} pagos en bancos, cajas o
                    transferencias con un ticket promedio de{" "}
                    {formatCurrency(ventanilla.ticketPromedio)}
                  </p>
                </div>
              </div>
              {evo.ticketPromedio > 0 && ventanilla.ticketPromedio > 0 && (
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center mt-0.5">
                    <ArrowRightLeft className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      Diferencia de ticket:{" "}
                      <span className="text-amber-400">
                        {formatCurrency(
                          Math.abs(evo.ticketPromedio - ventanilla.ticketPromedio)
                        )}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {evo.ticketPromedio > ventanilla.ticketPromedio
                        ? "Los pagos en línea tienen un ticket promedio mayor"
                        : "Transferencias + Presencial tiene un ticket promedio mayor"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ──── Daily stacked bar chart ──── */}
        {barData.length > 0 && (
          <div>
            <p className="text-xs text-slate-400 font-medium mb-3">
              Distribución diaria por canal ({viewMode === "volumen" ? "volumen" : "monto"})
            </p>
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
                    dataKey="name"
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 10 }}
                    tickFormatter={(v: number) =>
                      viewMode === "monto"
                        ? v >= 1000000
                          ? `$${(v / 1000000).toFixed(1)}M`
                          : v >= 1000
                            ? `$${(v / 1000).toFixed(0)}k`
                            : `$${v}`
                        : v >= 1000
                          ? `${(v / 1000).toFixed(0)}k`
                          : String(v)
                    }
                  />
                  <Tooltip
                    content={
                      <CustomTooltip
                        formatMap={{
                          evo: viewMode === "monto" ? "currency" : "number",
                          ventanilla: viewMode === "monto" ? "currency" : "number",
                        }}
                        labels={{
                          evo: "EVO (en línea)",
                          ventanilla: "Transferencias + Presencial",
                        }}
                      />
                    }
                  />
                  <Bar
                    dataKey="ventanilla"
                    stackId="a"
                    fill={VENTANILLA_COLOR}
                    fillOpacity={0.7}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="evo"
                    stackId="a"
                    fill={EVO_COLOR}
                    fillOpacity={0.8}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Bar legend */}
            <div className="flex items-center justify-center gap-6 mt-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-2 rounded-sm inline-block"
                  style={{ backgroundColor: EVO_COLOR, opacity: 0.8 }}
                />
                EVO (en línea)
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-2 rounded-sm inline-block"
                  style={{ backgroundColor: VENTANILLA_COLOR, opacity: 0.7 }}
                />
                Transferencias + Presencial
              </span>
            </div>
          </div>
        )}
      </motion.section>
    );
  }
);

PaymentChannelsSection.displayName = "PaymentChannelsSection";
