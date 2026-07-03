"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { motion } from "framer-motion";
import {
  CreditCard,
  DollarSign,
  Receipt,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { KPICard, kpiGridVariants } from "@/components/january";
import { MONTH_NAMES, MONTH_SHORT_NAMES } from "@/lib/constants";

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

const formatCompact = (n: number): string => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
};

const EVO_COLOR = "#34d399";
const PCT_COLOR = "#818cf8";

type TooltipEntry = {
  name?: string;
  value?: number | string;
  color?: string;
};

function EvoTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  currency?: boolean;
}): React.ReactElement | null {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-xl">
      <p className="text-sm font-semibold text-slate-200 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm" style={{ color: entry.color }}>
          {entry.name}:{" "}
          {typeof entry.value === "number"
            ? entry.name?.includes("%")
              ? `${entry.value.toFixed(1)}%`
              : currency
                ? formatCurrency(entry.value)
                : formatNumber(entry.value)
            : entry.value}
        </p>
      ))}
    </div>
  );
}

export function Evo2026Dashboard(): React.ReactElement {
  const data = useQuery(api.annualQueriesDatamapping.getEvoMonthlyByYear, {
    year: 2026,
  });

  const monthsWithData = useMemo(
    () => (data ? data.months.filter((m) => m.daysWithData > 0) : []),
    [data]
  );

  const chartData = useMemo(
    () =>
      monthsWithData.map((m) => ({
        month: MONTH_SHORT_NAMES[m.month] ?? String(m.month),
        Transacciones: m.evoCount,
        Monto: m.evoMonto,
        "% del monto": m.pctMonto,
        Ticket: m.ticketPromedio,
      })),
    [monthsWithData]
  );

  if (!data) {
    return (
      <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
        <div className="max-w-7xl mx-auto animate-pulse space-y-6">
          <div className="h-24 bg-slate-800/50 rounded-2xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-slate-800/50 rounded-2xl" />
            ))}
          </div>
          <div className="h-96 bg-slate-800/50 rounded-2xl" />
        </div>
      </div>
    );
  }

  const { totals, lastDataDate } = data;

  return (
    <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-slate-900/60 to-slate-900/60 p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-emerald-500/20 p-2.5">
                  <CreditCard className="w-6 h-6 text-emerald-400" />
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-100">
                  Pagos EVO 2026 por Mes
                </h1>
              </div>
              <p className="mt-2 text-sm text-slate-400 max-w-2xl">
                Recaudación del Portal de Pagos a través del{" "}
                <span className="text-emerald-400 font-medium">
                  Motor de Pagos EVO (Banamex)
                </span>
                . Solo pagos con estado{" "}
                <span className="text-slate-300">PAGO VALIDADO</span>, mes
                asignado por fecha de transacción (hora de México).
              </p>
            </div>
            {lastDataDate && (
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-2 text-right">
                <p className="text-xs text-slate-500">Datos al</p>
                <p className="text-sm font-semibold text-slate-200">
                  {lastDataDate}
                </p>
              </div>
            )}
          </div>
        </motion.header>

        {/* KPIs anuales */}
        <motion.div
          variants={kpiGridVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <KPICard
            value={totals.evoMonto}
            subtitle="Recaudado por EVO en 2026"
            icon={DollarSign}
            format="currency"
            accent
            tooltip="Suma de pagos validados vía motor EVO (Banamex) en 2026"
          />
          <KPICard
            value={totals.evoCount}
            subtitle="Transacciones EVO en 2026"
            icon={CreditCard}
            tooltip="Número de pagos validados vía EVO"
          />
          <KPICard
            value={totals.ticketPromedio}
            subtitle="Ticket promedio EVO"
            icon={Receipt}
            format="currency"
            tooltip="Monto promedio por transacción EVO"
          />
          <KPICard
            value={Math.round(totals.pctMonto)}
            subtitle="% del monto total del portal"
            icon={PieChartIcon}
            tooltip={`EVO representa ${totals.pctMonto.toFixed(1)}% del monto y ${totals.pctCount.toFixed(1)}% de las transacciones del portal en 2026`}
          />
        </motion.div>

        {/* Tabla mensual */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-6"
        >
          <h2 className="text-lg font-semibold text-slate-200 mb-4">
            Detalle mensual · EVO (Banamex) · 2026
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/60 text-left text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">Mes</th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Transacciones EVO
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Monto EVO
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Ticket promedio
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    % monto del portal
                  </th>
                  <th className="py-2.5 pl-4 font-medium text-right">
                    Total portal (todas las fuentes)
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthsWithData.map((m) => (
                  <tr
                    key={m.month}
                    className="border-b border-slate-800/60 text-slate-300 hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-medium text-slate-200">
                      {MONTH_NAMES[m.month] ?? m.month}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">
                      {formatNumber(m.evoCount)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-emerald-400 font-medium">
                      {formatCurrency(m.evoMonto)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">
                      {formatCurrency(m.ticketPromedio)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">
                      {m.pctMonto.toFixed(1)}%
                    </td>
                    <td className="py-2.5 pl-4 text-right tabular-nums text-slate-500">
                      {formatCurrency(m.totalMonto)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-slate-100 font-semibold">
                  <td className="py-3 pr-4">Total 2026</td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatNumber(totals.evoCount)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-emerald-400">
                    {formatCurrency(totals.evoMonto)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(totals.ticketPromedio)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {totals.pctMonto.toFixed(1)}%
                  </td>
                  <td className="py-3 pl-4 text-right tabular-nums text-slate-400">
                    {formatCurrency(totals.totalMonto)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </motion.section>

        {/* Gráfica de monto por mes */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-6"
        >
          <h2 className="text-lg font-semibold text-slate-200 mb-1">
            Monto recaudado por EVO por mes
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Barras: monto EVO · Línea: % que representa EVO del monto total del
            portal
          </p>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis
                  yAxisId="monto"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickFormatter={formatCompact}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  stroke={PCT_COLOR}
                  fontSize={12}
                  tickFormatter={(value: number) => `${value.toFixed(0)}%`}
                />
                <Tooltip content={<EvoTooltip currency />} />
                <Legend />
                <Bar
                  yAxisId="monto"
                  dataKey="Monto"
                  fill={EVO_COLOR}
                  radius={[6, 6, 0, 0]}
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="% del monto"
                  stroke={PCT_COLOR}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </motion.section>

        {/* Gráfica de transacciones por mes */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-6"
        >
          <h2 className="text-lg font-semibold text-slate-200 mb-4">
            Transacciones EVO por mes
          </h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={formatNumber} />
                <Tooltip content={<EvoTooltip />} />
                <Bar
                  dataKey="Transacciones"
                  fill={EVO_COLOR}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.section>

        <p className="text-xs text-slate-600 pb-4">
          Fuente: registros DataMapping (DynamoDB) con estado PAGO VALIDADO,
          fecha de transacción tomada de los logs de notificación de pago
          (CloudWatch) en hora de México. EVO corresponde al motor de pagos de
          Banamex.
        </p>
      </div>
    </div>
  );
}
