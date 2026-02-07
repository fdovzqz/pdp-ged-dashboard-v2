"use client";

import {
  Area,
  AreaChart,
  Bar,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);

interface DayData {
  date: string;
  count: number;
  monto: number;
  v1: number;
  v2: number;
  payment: number;
}

interface DailyTrendChartProps {
  days: DayData[];
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    value: number;
    dataKey: string;
    color: string;
    payload?: DayData;
  }>;
  label?: string;
}): React.ReactElement | null => {
  if (!active || !payload?.length) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="glass-card-elevated rounded-lg p-3 min-w-[200px]">
      <p className="text-xs font-medium text-muted-foreground mb-2">{data.date}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            Total Pagos
          </span>
          <span className="text-xs font-semibold tabular-nums">{data.count.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Monto
          </span>
          <span className="text-xs font-semibold tabular-nums">{formatCurrency(data.monto)}</span>
        </div>
        <div className="border-t border-border/50 pt-1.5 mt-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-purple-400">V1</span>
            <span className="text-xs tabular-nums">{data.v1.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-400">V2</span>
            <span className="text-xs tabular-nums">{data.v2.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400">EVO</span>
            <span className="text-xs tabular-nums">{data.payment.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const DailyTrendChart = ({ days }: DailyTrendChartProps): React.ReactElement => {
  const displayDays = days.map((d) => ({
    ...d,
    label: d.date.slice(8), // day number
  }));

  return (
    <div className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={displayDays} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradientCount" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#818cf8" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="gradientMonto" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={12}
            tick={{ fill: "#71717a", fontSize: 11 }}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fill: "#71717a", fontSize: 11 }}
            tickFormatter={(v: number) =>
              v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}K`
            }
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Legend
            verticalAlign="top"
            height={36}
            formatter={(value: string) => (
              <span className="text-xs text-muted-foreground">{value}</span>
            )}
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="monto"
            name="Monto"
            stroke="#34d399"
            fill="url(#gradientMonto)"
            strokeWidth={1.5}
            dot={false}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="count"
            name="Pagos"
            stroke="#818cf8"
            fill="url(#gradientCount)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "#818cf8", strokeWidth: 2, fill: "#09090b" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
