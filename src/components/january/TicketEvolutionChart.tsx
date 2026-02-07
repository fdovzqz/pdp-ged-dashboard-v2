"use client";

import { useMemo, memo } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import { CustomTooltip } from "./CustomTooltip";

export interface DailyAmountRow {
  day: number;
  events: number;
  totalAmount: number;
  transactionCount: number;
  ticketPromedio: number;
}

export interface TicketEvolutionChartProps {
  data: DailyAmountRow[] | undefined;
}

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export const TicketEvolutionChart = memo(({
  data,
}: TicketEvolutionChartProps): React.ReactElement => {
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    const totalAmount = data.reduce((s, d) => s + d.totalAmount, 0);
    const totalTx = data.reduce((s, d) => s + (d.transactionCount ?? d.events), 0);
    const ticketPromedioMes = totalTx > 0 ? Math.round(totalAmount / totalTx) : 0;
    const maxAmount = Math.max(...data.map((d) => d.totalAmount));
    const diasMaxPagos = data
      .filter((d) => d.totalAmount === maxAmount)
      .map((d) => d.day)
      .sort((a, b) => a - b);
    return { ticketPromedioMes, diasMaxPagos, maxAmount };
  }, [data]);

  if (data === undefined) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/40 backdrop-blur-sm rounded-3xl border border-slate-700/50 p-6 min-w-0"
      >
        <div className="flex items-center justify-center min-h-[280px]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <p className="text-slate-400 text-sm">Cargando evolución de ticket...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.55 }}
      className="glass-card rounded-2xl p-6 min-w-0 overflow-hidden"
    >
      <h3 className="text-lg font-semibold font-display mb-4">
        Evolución del Ticket Promedio
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Ticket promedio diario (línea) + volumen de pagos (barras)
      </p>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <Tooltip
              content={
                <CustomTooltip
                  labels={{
                    ticketPromedio: "Ticket Prom",
                    events: "Pagos",
                  }}
                />
              }
            />
            <Bar
              yAxisId="right"
              dataKey="events"
              fill="#34d399"
              fillOpacity={0.2}
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="ticketPromedio"
              stroke="#f59e0b"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: "#f59e0b", stroke: "#fff", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {stats && (
        <div className="mt-4 pt-4 border-t border-slate-700/50 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>
            <strong className="text-slate-300">Promedio del mes:</strong>{" "}
            {formatCurrency(stats.ticketPromedioMes)}
          </span>
          <span>
            <strong className="text-slate-300">Mayores pagos:</strong> día(s){" "}
            {stats.diasMaxPagos.join(", ")} ({formatCurrency(stats.maxAmount)})
          </span>
        </div>
      )}
    </motion.div>
  );
});

TicketEvolutionChart.displayName = "TicketEvolutionChart";
