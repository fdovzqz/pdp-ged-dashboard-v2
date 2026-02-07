"use client";

import { memo } from "react";
import { motion } from "framer-motion";
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

export interface StatsSectionProps {
  weekday: number;
  weekend: number;
  weekdayAmount?: number;
  weekendAmount?: number;
  weekdayDays?: number;
  weekendDays?: number;
  arranque: number;
  medio: number;
  cierre: number;
  arranqueAmount?: number;
  medioAmount?: number;
  cierreAmount?: number;
  total?: number;
  totalAmount?: number;
}

export const StatsSection = memo(({
  weekday,
  weekend,
  weekdayAmount = 0,
  weekendAmount = 0,
  weekdayDays = 23,
  weekendDays = 8,
  arranque,
  medio,
  cierre,
  arranqueAmount = 0,
  medioAmount = 0,
  cierreAmount = 0,
  total,
  totalAmount = 0,
}: StatsSectionProps): React.ReactElement => {
  const weekdayAvg = weekdayDays > 0 ? Math.round(weekday / weekdayDays) : 0;
  const weekendAvg = weekendDays > 0 ? Math.round(weekend / weekendDays) : 0;
  const weekdayAvgAmount = weekdayDays > 0 ? Math.round(weekdayAmount / weekdayDays) : 0;
  const weekendAvgAmount = weekendDays > 0 ? Math.round(weekendAmount / weekendDays) : 0;
  const totalPagos = total ?? weekday + weekend;

  const barData = [
    { name: "L-V", total: weekday, promedio: weekdayAvg, monto: weekdayAmount, promedioMonto: weekdayAvgAmount },
    { name: "S-D", total: weekend, promedio: weekendAvg, monto: weekendAmount, promedioMonto: weekendAvgAmount },
  ];

  const periods = [
    {
      label: "Arranque (1-7)",
      value: arranque,
      amount: arranqueAmount,
      days: 7,
      color: "rose",
      bgClass: "bg-rose-500/15 border-rose-500/30",
      textClass: "text-rose-400",
    },
    {
      label: "Medio (8-24)",
      value: medio,
      amount: medioAmount,
      days: 17,
      color: "violet",
      bgClass: "bg-violet-500/15 border-violet-500/30",
      textClass: "text-violet-400",
    },
    {
      label: "Cierre (25-31)",
      value: cierre,
      amount: cierreAmount,
      days: 7,
      color: "emerald",
      bgClass: "bg-emerald-500/15 border-emerald-500/30",
      textClass: "text-emerald-400",
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.35 }}
      className="grid grid-cols-1 lg:grid-cols-2 gap-6"
    >
      {/* Volumen y recaudación: L-V vs S-D */}
      <div className="glass-card rounded-2xl p-6 min-w-0 overflow-hidden flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-lg font-semibold font-display">
            Volumen y recaudación: días hábiles vs fin de semana
          </h3>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>L-V: <strong className="text-emerald-400">{formatNumber(weekday)}</strong> pagos</span>
            <span>·</span>
            <span>S-D: <strong className="text-violet-400">{formatNumber(weekend)}</strong> pagos</span>
            {(weekdayAmount > 0 || weekendAmount > 0) && (
              <>
                <span>·</span>
                <span>L-V: <strong className="text-amber-400">{formatCurrency(weekdayAmount)}</strong></span>
                <span>S-D: <strong className="text-amber-400">{formatCurrency(weekendAmount)}</strong></span>
              </>
            )}
          </div>
        </div>
        <div className="h-[320px] min-h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={barData}
              margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis
                yAxisId="left"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                label={{ value: "Pagos", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }}
              />
              {(weekdayAmount > 0 || weekendAmount > 0) && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "#f59e0b", fontSize: 12 }}
                  tickFormatter={(v) =>
                    v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}k`
                  }
                  label={{ value: "MXN", angle: 90, position: "insideRight", fill: "#f59e0b", fontSize: 10 }}
                />
              )}
              <Tooltip
                content={
                  <CustomTooltip
                    formatMap={{ total: "number", promedio: "number", monto: "currency", promedioMonto: "currency" }}
                    labels={{ total: "Pagos", promedio: "Prom/día", monto: "Monto", promedioMonto: "Prom $/día" }}
                  />
                }
              />
              <Bar yAxisId="left" dataKey="total" fill="#34d399" radius={[4, 4, 0, 0]} />
              {(weekdayAmount > 0 || weekendAmount > 0) && (
                <Bar yAxisId="right" dataKey="monto" fill="#f59e0b" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-700/30 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
          <span>L-V: {formatNumber(weekdayAvg)} prom/día{weekdayAmount > 0 && <> · {formatCurrency(weekdayAvgAmount)}/día</>} ({weekdayDays} días)</span>
          <span>S-D: {formatNumber(weekendAvg)} prom/día{weekendAmount > 0 && <> · {formatCurrency(weekendAvgAmount)}/día</>} ({weekendDays} días)</span>
        </div>
      </div>

      {/* Por período */}
      <div className="glass-card rounded-2xl p-6 min-w-0">
        <h3 className="text-lg font-semibold font-display mb-4">
          Análisis por período (pagos y montos)
        </h3>
        <div className="space-y-3">
          {periods.map((p) => {
            const avgDaily = Math.round(p.value / p.days);
            const avgDailyAmount = p.days > 0 ? Math.round(p.amount / p.days) : 0;
            const pctOfTotal = totalPagos > 0 ? ((p.value / totalPagos) * 100).toFixed(1) : "0.0";
            const pctAmount = totalAmount > 0 && p.amount > 0 ? ((p.amount / totalAmount) * 100).toFixed(1) : "0.0";
            return (
              <div
                key={p.label}
                className={`rounded-xl border p-4 ${p.bgClass}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-medium ${p.textClass}`}>
                    {p.label}
                  </span>
                  <span className="text-lg font-bold tabular-nums">
                    {formatNumber(p.value)}
                  </span>
                </div>
                {p.amount > 0 && (
                  <p className="text-sm font-semibold tabular-nums text-amber-400 mb-1">
                    {formatCurrency(p.amount)}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span>{pctOfTotal}% pagos</span>
                  {pctAmount !== "0.0" && <span>· {pctAmount}% monto</span>}
                  <span className="text-slate-600">·</span>
                  <span>{formatNumber(avgDaily)}/día</span>
                  {avgDailyAmount > 0 && (
                    <span>· {formatCurrency(avgDailyAmount)}/día</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.section>
  );
});

StatsSection.displayName = "StatsSection";
