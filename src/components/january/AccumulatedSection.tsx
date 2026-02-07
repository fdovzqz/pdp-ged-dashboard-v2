"use client";

import { useMemo, memo } from "react";
import { motion } from "framer-motion";

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export interface PeriodData {
  arranque: number;
  medio: number;
  cierre: number;
  arranqueAmount?: number;
  medioAmount?: number;
  cierreAmount?: number;
}

export interface AccumulatedSectionProps {
  total: number;
  totalAmount?: number;
  lastAvailableDay: number;
  periods?: PeriodData;
}

const PERIOD_CONFIG = [
  { key: "arranque" as const, label: "Arranque (1-7)", days: 7, color: "#f472b6" },
  { key: "medio" as const, label: "Medio (8-24)", days: 17, color: "#a78bfa" },
  { key: "cierre" as const, label: "Cierre (25-31)", days: 7, color: "#34d399" },
];

export const AccumulatedSection = memo(({
  total,
  totalAmount = 0,
  lastAvailableDay,
  periods,
}: AccumulatedSectionProps): React.ReactElement => {
  const periodBars = useMemo(() => {
    if (!periods) return [];
    const max = Math.max(periods.arranque, periods.medio, periods.cierre, 1);
    return PERIOD_CONFIG.map((cfg) => {
      const value = periods[cfg.key];
      const amount =
        (cfg.key === "arranque" ? periods.arranqueAmount :
         cfg.key === "medio" ? periods.medioAmount :
         periods.cierreAmount) ?? 0;
      const pct = (value / max) * 100;
      const avgDaily = Math.round(value / cfg.days);
      const avgDailyAmount = cfg.days > 0 ? Math.round(amount / cfg.days) : 0;
      const pctTotal = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
      return { ...cfg, value, amount, pct, avgDaily, avgDailyAmount, pctTotal };
    });
  }, [periods, total]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="glass-card rounded-2xl p-6 min-w-0"
    >
      <h3 className="text-lg font-semibold font-display mb-2">Total acumulado</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Pagos y recaudación hasta día {lastAvailableDay} de enero 2026
      </p>

      {periods && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {periodBars.map((p) => (
            <div
              key={p.key}
              className="rounded-xl bg-slate-800/40 border border-slate-700/30 p-4"
            >
              <p className="text-xs text-slate-400 font-medium mb-1">{p.label}</p>
              <p className="text-2xl font-bold tabular-nums">{formatNumber(p.value)}</p>
              {p.amount > 0 && (
                <p className="text-sm font-semibold tabular-nums text-amber-400 mt-0.5">
                  {formatCurrency(p.amount)}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {formatNumber(p.avgDaily)}/día
                </span>
                {p.avgDailyAmount > 0 && (
                  <>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-amber-400/80">
                      {formatCurrency(p.avgDailyAmount)}/día
                    </span>
                  </>
                )}
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs text-muted-foreground">{p.pctTotal}% del mes</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {periods && (
        <div className="space-y-3 mb-6">
          {periodBars.map((p, i) => (
            <div key={p.key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-400">{p.label}</span>
                <span className="text-xs font-semibold tabular-nums">
                  {formatNumber(p.value)}
                  {p.amount > 0 && (
                    <span className="text-amber-400/80 ml-1">· {formatCurrency(p.amount)}</span>
                  )}
                </span>
              </div>
              <div className="h-8 bg-slate-800/50 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${p.pct}%` }}
                  transition={{ duration: 1, delay: 0.5 + i * 0.15, ease: "easeOut" }}
                  className="h-8 rounded-full flex items-center justify-end pr-3"
                  style={{ backgroundColor: `${p.color}80` }}
                >
                  <span className="text-xs font-bold text-white whitespace-nowrap">
                    {formatNumber(p.value)}
                  </span>
                </motion.div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[180px] rounded-xl bg-emerald-500/10 p-5 border border-emerald-500/20">
          <p className="text-3xl font-bold tabular-nums text-emerald-400">
            {formatNumber(total)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">total de pagos</p>
        </div>
        {totalAmount > 0 && (
          <div className="flex-1 min-w-[180px] rounded-xl bg-amber-500/10 p-5 border border-amber-500/20">
            <p className="text-2xl font-bold tabular-nums text-amber-400">
              {formatCurrency(totalAmount)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">recaudación total</p>
          </div>
        )}
      </div>
    </motion.section>
  );
});

AccumulatedSection.displayName = "AccumulatedSection";
