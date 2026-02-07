"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { motion } from "framer-motion";

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);

interface SourceStat {
  source: string;
  count: number;
  monto: number;
  pctCount: number;
  pctMonto: number;
}

interface SourceComparisonChartProps {
  sources: SourceStat[];
}

const SOURCE_CONFIG: Record<string, { label: string; color: string; bgClass: string }> = {
  v1: { label: "Conciliaci\u00f3n V1", color: "#a78bfa", bgClass: "bg-violet-500/10 border-violet-500/20 text-violet-400" },
  v2: { label: "Conciliaci\u00f3n V2", color: "#60a5fa", bgClass: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
  payment: { label: "EVO (Payment)", color: "#34d399", bgClass: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
};

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; count: number; monto: number; pct: number } }>;
}): React.ReactElement | null => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="glass-card-elevated rounded-lg p-3 min-w-[180px]">
      <p className="text-xs font-semibold mb-1.5">{d.name}</p>
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Pagos</span>
          <span className="font-semibold tabular-nums">{d.count.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Monto</span>
          <span className="font-semibold tabular-nums">{formatCurrency(d.monto)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">% Pagos</span>
          <span className="font-semibold tabular-nums">{d.pct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
};

export const SourceComparisonChart = ({
  sources,
}: SourceComparisonChartProps): React.ReactElement => {
  const totalCount = sources.reduce((s, x) => s + x.count, 0);

  const data = sources.map((s) => ({
    name: SOURCE_CONFIG[s.source]?.label ?? s.source,
    count: s.count,
    monto: s.monto,
    pct: totalCount > 0 ? (s.count / totalCount) * 100 : 0,
    color: SOURCE_CONFIG[s.source]?.color ?? "#71717a",
  }));

  return (
    <div className="flex flex-col lg:flex-row items-center gap-6">
      {/* Donut chart */}
      <div className="w-[220px] h-[220px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={3}
              dataKey="count"
              stroke="none"
              animationBegin={200}
              animationDuration={800}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold tabular-nums">{totalCount.toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</span>
        </div>
      </div>

      {/* Legend + details */}
      <div className="flex-1 space-y-3 w-full">
        {sources.map((s, i) => {
          const config = SOURCE_CONFIG[s.source];
          const pct = totalCount > 0 ? (s.count / totalCount) * 100 : 0;
          return (
            <motion.div
              key={s.source}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
              className="flex items-center gap-4"
            >
              <div className={`flex items-center justify-center w-10 h-10 rounded-lg border ${config?.bgClass ?? ""}`}>
                <span className="text-xs font-bold">
                  {s.source === "payment" ? "EVO" : s.source.toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{config?.label ?? s.source}</span>
                  <span className="text-sm font-semibold tabular-nums">{s.count.toLocaleString()}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ delay: 0.5 + i * 0.1, duration: 0.6, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: config?.color ?? "#71717a" }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatCurrency(s.monto)} &middot; {pct.toFixed(1)}%
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
