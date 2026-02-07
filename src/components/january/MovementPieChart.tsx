"use client";

import { useMemo, memo } from "react";
import { motion } from "framer-motion";
import { useGetMovementDescription } from "@/hooks/useMovementDescription";
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

export type SortByMovement = "monto" | "volumen";

export interface MovementPieChartProps {
  data: Array<{ movimiento: string; totalAmount: number; count: number }>;
  sortBy?: SortByMovement;
}

export const MovementPieChart = memo(({
  data,
  sortBy = "monto",
}: MovementPieChartProps): React.ReactElement => {
  const getDescription = useGetMovementDescription();
  const display = useMemo(() => {
    const sorted = [...data].sort((a, b) =>
      sortBy === "monto" ? b.totalAmount - a.totalAmount : b.count - a.count
    );
    const top12 = sorted.slice(0, 12);
    const rest = sorted.slice(12);
    const othersAmount = rest.reduce((s, d) => s + d.totalAmount, 0);
    const othersCount = rest.reduce((s, d) => s + d.count, 0);

    const items = top12.map((d) => {
      const label = getDescription(d.movimiento);
      return {
        name: label.length > 40 ? label.slice(0, 40) + "…" : label,
        monto: d.totalAmount,
        count: d.count,
        fullName: label,
      };
    });
    if (othersCount > 0 || othersAmount > 0) {
      items.push({
        name: "OTROS MOVIMIENTOS",
        monto: othersAmount,
        count: othersCount,
        fullName: "OTROS MOVIMIENTOS",
      });
    }
    return items;
  }, [data, sortBy, getDescription]);

  const chartHeight = Math.min(850, Math.max(420, display.length * 35));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="glass-card rounded-xl p-6"
    >
      <h3 className="text-lg font-semibold mb-4">
        Movimientos por {sortBy === "monto" ? "ingreso" : "volumen"}
      </h3>
      <div style={{ height: chartHeight }} className="min-h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={display}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              type="number"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(v) =>
                sortBy === "monto" ? `$${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <YAxis
              type="category"
              dataKey="name"
              width={200}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
            />
            <Tooltip
              content={
                <CustomTooltip
                  format={sortBy === "monto" ? "currency" : "number"}
                  labels={{ monto: "Monto", count: "Pagos" }}
                />
              }
            />
            <Bar
              dataKey={sortBy === "monto" ? "monto" : "count"}
              fill="#34d399"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
});

MovementPieChart.displayName = "MovementPieChart";
