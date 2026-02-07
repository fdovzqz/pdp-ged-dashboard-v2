"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { CustomTooltip } from "./CustomTooltip";

const COLORS = { eventos: "#34d399", monto: "#a78bfa" };

export interface AmountChartProps {
  data: Array<{
    day: number;
    eventos2024: number;
    eventos2025: number;
    eventos2026: number;
    monto2024: number;
    monto2025: number;
    monto2026: number;
  }>;
  activeYears: Set<string>;
}

export const AmountChart = ({
  data,
  activeYears,
}: AmountChartProps): React.ReactElement => {
  const maxMonto = useMemo(
    () =>
      Math.max(
        ...data.flatMap((d) => [
          d.monto2024,
          d.monto2025,
          d.monto2026,
        ]),
        1
      ),
    [data]
  );

  const chartData = data.map((d) => ({
    day: d.day,
    ...(activeYears.has("2024") && {
      eventos2024: d.eventos2024,
      monto2024: d.monto2024,
    }),
    ...(activeYears.has("2025") && {
      eventos2025: d.eventos2025,
      monto2025: d.monto2025,
    }),
    ...(activeYears.has("2026") && {
      eventos2026: d.eventos2026,
      monto2026: d.monto2026,
    }),
  }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="glass-card rounded-xl p-6"
    >
      <h3 className="text-lg font-semibold mb-4">Ingresos acumulados vs eventos</h3>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis
              yAxisId="left"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <Tooltip
              content={
                <CustomTooltip
                  format="currency"
                  labels={{
                    monto2024: "2024 $",
                    monto2025: "2025 $",
                    monto2026: "2026 $",
                    eventos2024: "2024 #",
                    eventos2025: "2025 #",
                    eventos2026: "2026 #",
                  }}
                />
              }
            />
            <Legend />
            {activeYears.has("2026") && (
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="monto2026"
                stroke="#a78bfa"
                fill="#a78bfa"
                fillOpacity={0.2}
                strokeWidth={2}
                name="2026 $"
              />
            )}
            {activeYears.has("2026") && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="eventos2026"
                stroke="#34d399"
                fill="#34d399"
                fillOpacity={0.2}
                strokeWidth={2}
                name="2026 #"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};
