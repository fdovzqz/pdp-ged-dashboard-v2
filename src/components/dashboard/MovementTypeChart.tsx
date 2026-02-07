"use client";

import { motion } from "framer-motion";
import { useGetMovementDescription } from "@/hooks/useMovementDescription";

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);

interface MovementStat {
  movimiento: string;
  count: number;
  monto: number;
  v1: number;
  v2: number;
  payment: number;
}

interface MovementTypeChartProps {
  byMovimiento: MovementStat[];
}

const COLORS = [
  "#818cf8", "#60a5fa", "#34d399", "#fbbf24", "#f472b6",
  "#a78bfa", "#38bdf8", "#6ee7b7", "#f59e0b", "#fb7185",
];

export const MovementTypeChart = ({
  byMovimiento,
}: MovementTypeChartProps): React.ReactElement => {
  const getDescription = useGetMovementDescription();
  const data = byMovimiento.slice(0, 10);
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="space-y-3">
      {data.map((m, i) => {
        const pct = (m.count / maxCount) * 100;
        const color = COLORS[i % COLORS.length];
        const label = getDescription(m.movimiento);

        return (
          <motion.div
            key={m.movimiento || "(sin tipo)"}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4 }}
            className="group"
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className="text-sm font-medium truncate max-w-[200px]"
                title={label}
              >
                {label}
              </span>
              <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 ml-4">
                <span className="tabular-nums font-semibold text-foreground">
                  {m.count.toLocaleString()}
                </span>
                <span className="tabular-nums hidden sm:inline">
                  {formatCurrency(m.monto)}
                </span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ delay: 0.3 + i * 0.05, duration: 0.6, ease: "easeOut" }}
                className="h-full rounded-full group-hover:opacity-90 transition-opacity"
                style={{
                  background: `linear-gradient(90deg, ${color} 0%, ${color}99 100%)`,
                }}
              />
            </div>
            {/* Source breakdown mini badges */}
            <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
              {m.v1 > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                  V1: {m.v1}
                </span>
              )}
              {m.v2 > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  V2: {m.v2}
                </span>
              )}
              {m.payment > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  EVO: {m.payment}
                </span>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
