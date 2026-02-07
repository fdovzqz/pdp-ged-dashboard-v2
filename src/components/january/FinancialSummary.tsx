"use client";

import { useMemo, useState, memo } from "react";
import { motion } from "framer-motion";
import { useGetMovementDescription } from "@/hooks/useMovementDescription";
import { DollarSign, TrendingUp, Target, Loader2 } from "lucide-react";
import { MovementPieChart } from "./MovementPieChart";
import type { SortByMovement } from "./MovementPieChart";
import { cn } from "@/lib/utils";

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export interface AmountTotals {
  [year: string]: {
    totalAmount: number;
    events: number;
    ticketPromedio: number;
  };
}

export interface FinancialSummaryProps {
  amountTotals: AmountTotals | undefined;
  topMovements: Array<{ movimiento: string; totalAmount: number; count: number }>;
}

export const FinancialSummary = memo(({
  amountTotals,
  topMovements,
}: FinancialSummaryProps): React.ReactElement => {
  const getDescription = useGetMovementDescription();
  const [sortBy, setSortBy] = useState<SortByMovement>("monto");

  const v = amountTotals?.["2026"] ?? { totalAmount: 0, events: 0, ticketPromedio: 0 };

  const paretoInfo = useMemo(() => {
    if (!topMovements || topMovements.length === 0 || v.totalAmount <= 0) return null;
    let accumulated = 0;
    let count = 0;
    const sorted = [...topMovements].sort((a, b) => b.totalAmount - a.totalAmount);
    for (const m of sorted) {
      accumulated += m.totalAmount;
      count++;
      if (accumulated >= v.totalAmount * 0.8) break;
    }
    const pctTypes = ((count / sorted.length) * 100).toFixed(0);
    return { count, total: sorted.length, pctTypes };
  }, [topMovements, v.totalAmount]);

  const tableData = useMemo(() => {
    if (!topMovements || topMovements.length === 0) return [];
    const sorted =
      sortBy === "monto"
        ? [...topMovements].sort((a, b) => b.totalAmount - a.totalAmount)
        : [...topMovements].sort((a, b) => b.count - a.count);
    const top12 = sorted.slice(0, 12);
    const rest = sorted.slice(12);
    const othersCount = rest.reduce((s, m) => s + m.count, 0);
    const othersAmount = rest.reduce((s, m) => s + m.totalAmount, 0);

    const rows = top12.map((m) => ({
      movimiento: getDescription(m.movimiento),
      count: m.count,
      totalAmount: m.totalAmount,
      ticketProm: m.count > 0 ? Math.round(m.totalAmount / m.count) : 0,
      pctIngreso:
        v.totalAmount > 0
          ? ((m.totalAmount / v.totalAmount) * 100).toFixed(1)
          : "0.0",
      pctVolumen:
        v.events > 0 ? ((m.count / v.events) * 100).toFixed(1) : "0.0",
      isOthers: false,
    }));

    if (othersCount > 0 || othersAmount > 0) {
      rows.push({
        movimiento: "OTROS MOVIMIENTOS",
        count: othersCount,
        totalAmount: othersAmount,
        ticketProm: othersCount > 0 ? Math.round(othersAmount / othersCount) : 0,
        pctIngreso:
          v.totalAmount > 0
            ? ((othersAmount / v.totalAmount) * 100).toFixed(1)
            : "0.0",
        pctVolumen:
          v.events > 0 ? ((othersCount / v.events) * 100).toFixed(1) : "0.0",
        isOthers: true,
      });
    }
    return rows;
  }, [topMovements, v.totalAmount, v.events, sortBy, getDescription]);

  if (amountTotals === undefined) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/40 backdrop-blur-sm rounded-3xl border border-slate-700/50 p-6 min-w-0"
      >
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <p className="text-slate-400 text-sm">Cargando resumen financiero...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className="glass-card rounded-2xl p-6 min-w-0 overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h3 className="text-lg font-semibold font-display">Resumen financiero</h3>
        <div className="flex gap-1">
          {(["monto", "volumen"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSortBy(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                sortBy === s
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-slate-800/50 text-slate-400 hover:text-slate-300"
              )}
            >
              {s === "monto" ? "Por monto" : "Por volumen"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <DollarSign className="w-8 h-8 text-emerald-400" />
          <div>
            <p className="text-xs text-muted-foreground">Ingreso total</p>
            <p className="text-2xl font-bold tabular-nums">{formatCurrency(v.totalAmount)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
          <TrendingUp className="w-8 h-8 text-violet-400" />
          <div>
            <p className="text-xs text-muted-foreground">Ticket promedio</p>
            <p className="text-2xl font-bold tabular-nums">{formatCurrency(v.ticketPromedio)}</p>
          </div>
        </div>
        {paretoInfo && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Target className="w-8 h-8 text-amber-400" />
            <div>
              <p className="text-xs text-muted-foreground">Concentración 80/20</p>
              <p className="text-lg font-bold tabular-nums">
                {paretoInfo.pctTypes}% de trámites
              </p>
              <p className="text-xs text-muted-foreground">
                genera el 80% del ingreso
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MovementPieChart data={topMovements} sortBy={sortBy} />

        {tableData.length > 0 && (
          <div className="min-w-0">
            <h3 className="text-lg font-semibold mb-4">
              Ordenado por {sortBy === "monto" ? "ingreso (mayor a menor)" : "volumen (mayor a menor)"}
            </h3>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/40">
                  <th className="text-left py-2 px-2 text-xs font-medium text-slate-400">
                    Movimiento
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-slate-400 font-mono">
                    Pagos
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-slate-400 font-mono">
                    Ingreso
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-slate-400 font-mono">
                    Ticket
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-slate-400 font-mono">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, index) => (
                  <tr
                    key={row.isOthers ? "otros-movimientos" : index}
                    className={cn(
                      "border-b border-slate-800/40 hover:bg-slate-800/20",
                      row.isOthers && "bg-slate-800/40 font-medium"
                    )}
                  >
                    <td className="py-2 px-2 text-xs truncate max-w-[140px]" title={row.movimiento}>
                      {row.movimiento}
                    </td>
                    <td className="py-2 px-2 text-xs text-right tabular-nums font-mono">
                      {formatNumber(row.count)}
                    </td>
                    <td className="py-2 px-2 text-xs text-right tabular-nums font-mono">
                      {formatCurrency(row.totalAmount)}
                    </td>
                    <td className="py-2 px-2 text-xs text-right tabular-nums font-mono">
                      {formatCurrency(row.ticketProm)}
                    </td>
                    <td className="py-2 px-2 text-xs text-right tabular-nums font-mono text-emerald-400">
                      {sortBy === "monto" ? row.pctIngreso : row.pctVolumen}%
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-600/50 bg-slate-800/30 font-semibold">
                  <td className="py-2 px-2 text-xs">Total</td>
                  <td className="py-2 px-2 text-xs text-right tabular-nums font-mono">
                    {formatNumber(v.events)}
                  </td>
                  <td className="py-2 px-2 text-xs text-right tabular-nums font-mono">
                    {formatCurrency(v.totalAmount)}
                  </td>
                  <td className="py-2 px-2 text-xs text-right tabular-nums font-mono">—</td>
                  <td className="py-2 px-2 text-xs text-right tabular-nums font-mono text-emerald-400">
                    100%
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
});

FinancialSummary.displayName = "FinancialSummary";
