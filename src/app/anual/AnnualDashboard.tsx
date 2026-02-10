"use client";

import { useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { DataSource } from "@/lib/types";
import { motion } from "framer-motion";
import {
  CreditCard,
  DollarSign,
  TrendingUp,
  CalendarDays,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
} from "recharts";
import {
  KPICard,
  kpiGridVariants,
  CustomTooltip,
  AnnualPaymentBySourceSection,
} from "@/components/january";
import { MONTH_SHORT_NAMES, MONTH_NAMES } from "@/lib/constants";

const YEAR_COLORS: Record<string, string> = {
  "2024": "#94a3b8",
  "2025": "#818cf8",
  "2026": "#34d399",
};

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

export function AnnualDashboard(): React.ReactElement {
  const searchParams = useSearchParams();
  const dataSource: DataSource =
    searchParams.get("source") === "datamapping" ? "datamapping" : "cloudwatch";

  const annualApi =
    dataSource === "datamapping"
      ? api.annualQueriesDatamapping
      : api.annualQueries;

  const monthlyBreakdown = useQuery(annualApi.getMonthlyBreakdown);
  const annualKPIs = useQuery(annualApi.getAnnualKPIs);
  const yoyGrowth = useQuery(annualApi.getYearOverYearGrowth);
  const extremes = useQuery(annualApi.getAnnualExtremes);
  const cumulativeData = useQuery(annualApi.getAnnualCumulative);
  const annualPaymentBySource = useQuery(
    api.annualQueriesDatamapping.getAnnualPaymentBySource
  );

  const handleSourceChange = useCallback((source: DataSource) => {
    const url = new URL(window.location.href);
    url.searchParams.set("source", source);
    window.history.replaceState({}, "", url.toString());
    window.location.href = url.toString();
  }, []);

  const chartData = useMemo(() => {
    if (!monthlyBreakdown) return [];
    return monthlyBreakdown.map((row) => ({
      month: MONTH_SHORT_NAMES[row.month] ?? String(row.month),
      monthNum: row.month,
      "2024": row["2024_events"],
      "2025": row["2025_events"],
      "2026": row["2026_events"],
      "2024_amount": row["2024_amount"],
      "2025_amount": row["2025_amount"],
      "2026_amount": row["2026_amount"],
    }));
  }, [monthlyBreakdown]);

  const amountChartData = useMemo(() => {
    if (!monthlyBreakdown) return [];
    return monthlyBreakdown.map((row) => ({
      month: MONTH_SHORT_NAMES[row.month] ?? String(row.month),
      "2024": row["2024_amount"],
      "2025": row["2025_amount"],
      "2026": row["2026_amount"],
    }));
  }, [monthlyBreakdown]);

  const cumulativeChartData = useMemo(() => {
    if (!cumulativeData) return [];
    return cumulativeData.map((row) => ({
      month: MONTH_SHORT_NAMES[row.month] ?? String(row.month),
      "2024": row["2024_cumEvents"],
      "2025": row["2025_cumEvents"],
      "2026": row["2026_cumEvents"],
    }));
  }, [cumulativeData]);

  const cumulativeAmountData = useMemo(() => {
    if (!cumulativeData) return [];
    return cumulativeData.map((row) => ({
      month: MONTH_SHORT_NAMES[row.month] ?? String(row.month),
      "2024": row["2024_cumAmount"],
      "2025": row["2025_cumAmount"],
      "2026": row["2026_cumAmount"],
    }));
  }, [cumulativeData]);

  const isLoading =
    !monthlyBreakdown || !annualKPIs || !yoyGrowth || !extremes || !cumulativeData;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-24 bg-slate-800/50 rounded-2xl" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-slate-800/50 rounded-2xl" />
              ))}
            </div>
            <div className="h-96 bg-slate-800/50 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const kpi2026 = annualKPIs["2026"];

  const growthEvents = yoyGrowth.events["2025vs2026"];
  const growthAmount = yoyGrowth.amount["2025vs2026"];

  return (
    <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* ── Header ── */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap items-start justify-between gap-4 mb-2"
        >
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500/30 blur-xl rounded-full" />
              <div className="relative bg-gradient-to-br from-indigo-400 to-violet-600 p-4 rounded-2xl shadow-lg shadow-indigo-500/20">
                <BarChart3 size={32} className="text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight font-display gradient-text-emerald">
                Análisis Anual Comparativo
              </h1>
              <p className="mt-1.5 text-muted-foreground text-sm max-w-2xl">
                Visión ejecutiva del comportamiento de pagos año a año.
                Datos disponibles: Ene–Dic 2024, Ene–Dic 2025, Ene–Feb 2026.
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <div className="flex rounded-lg border border-slate-700/50 overflow-hidden bg-slate-800/40">
                  <button
                    type="button"
                    onClick={() => handleSourceChange("cloudwatch")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      dataSource === "cloudwatch"
                        ? "bg-emerald-500/30 text-emerald-400"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    CloudWatch
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSourceChange("datamapping")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      dataSource === "datamapping"
                        ? "bg-amber-500/30 text-amber-400"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    DataMapping
                  </button>
                </div>
                {(["2024", "2025", "2026"] as const).map((y) => (
                  <span
                    key={y}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border"
                    style={{
                      backgroundColor: `${YEAR_COLORS[y]}15`,
                      color: YEAR_COLORS[y],
                      borderColor: `${YEAR_COLORS[y]}40`,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: YEAR_COLORS[y] }}
                    />
                    {y} · {annualKPIs[y]?.monthsWithData ?? 0} meses
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.header>

        {/* ── KPI Cards ── */}
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          initial="hidden"
          animate="visible"
          variants={kpiGridVariants}
        >
          <KPICard
            value={kpi2026?.events ?? 0}
            subtitle="Total Pagos 2026"
            icon={CreditCard}
            accent
            trend={growthEvents}
            tooltip="vs. mismos meses 2025"
          />
          <KPICard
            value={kpi2026?.totalAmount ?? 0}
            subtitle="Recaudación 2026"
            icon={DollarSign}
            format="currency"
            trend={growthAmount}
            tooltip="vs. mismos meses 2025"
          />
          <KPICard
            value={kpi2026?.avgMonthly ?? 0}
            subtitle="Promedio mensual pagos"
            icon={TrendingUp}
            tooltip="Pagos promedio por mes en 2026"
          />
          <KPICard
            value={kpi2026?.ticketPromedio ?? 0}
            subtitle="Ticket promedio 2026"
            icon={CalendarDays}
            format="currency"
            tooltip="Monto promedio por transacción"
          />
        </motion.div>

        {/* ── Year-over-Year Growth Cards ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {(["2024", "2025", "2026"] as const).map((y) => {
            const kpi = annualKPIs[y];
            const extreme = extremes[y];
            const bestMonthName =
              extreme?.bestMonth?.month > 0
                ? MONTH_NAMES[extreme.bestMonth.month]
                : "—";
            return (
              <div
                key={y}
                className="glass-card rounded-2xl p-5 border-l-4"
                style={{ borderLeftColor: YEAR_COLORS[y] }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3
                    className="text-lg font-bold"
                    style={{ color: YEAR_COLORS[y] }}
                  >
                    {y}
                  </h3>
                  <span className="text-xs text-slate-400">
                    {kpi?.monthsWithData ?? 0} meses de datos
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">Pagos</p>
                    <p className="font-semibold tabular-nums">
                      {formatNumber(kpi?.events ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Recaudación</p>
                    <p className="font-semibold tabular-nums">
                      {formatCurrency(kpi?.totalAmount ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Prom. mensual</p>
                    <p className="font-semibold tabular-nums">
                      {formatNumber(kpi?.avgMonthly ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Mejor mes</p>
                    <p className="font-semibold text-emerald-400">
                      {bestMonthName}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </motion.div>

        {/* ── Growth Comparison ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="glass-card rounded-2xl p-6"
        >
          <h3 className="text-lg font-semibold font-display mb-4">
            Crecimiento Interanual
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                label: "2024 → 2025",
                events: yoyGrowth.events["2024vs2025"],
                amount: yoyGrowth.amount["2024vs2025"],
              },
              {
                label: "2025 → 2026",
                events: yoyGrowth.events["2025vs2026"],
                amount: yoyGrowth.amount["2025vs2026"],
              },
              {
                label: "2024 → 2026",
                events: yoyGrowth.events["2024vs2026"],
                amount: yoyGrowth.amount["2024vs2026"],
              },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30"
              >
                <p className="text-sm font-medium text-slate-300 mb-3">
                  {item.label}
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Pagos</span>
                    <span
                      className={`flex items-center gap-1 text-sm font-bold ${item.events >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {item.events >= 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5" />
                      )}
                      {item.events >= 0 ? "+" : ""}
                      {item.events.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Recaudación</span>
                    <span
                      className={`flex items-center gap-1 text-sm font-bold ${item.amount >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                    >
                      {item.amount >= 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5" />
                      )}
                      {item.amount >= 0 ? "+" : ""}
                      {item.amount.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Monthly Events Comparison Chart ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="glass-card rounded-2xl p-6"
        >
          <h3 className="text-lg font-semibold font-display mb-1">
            Pagos Mensuales — Comparativo
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Total de pagos registrados por mes para cada año
          </p>
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip
                  content={
                    <CustomTooltip
                      labels={{
                        "2024": "2024",
                        "2025": "2025",
                        "2026": "2026",
                      }}
                    />
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
                />
                <Bar
                  dataKey="2024"
                  fill={YEAR_COLORS["2024"]}
                  radius={[2, 2, 0, 0]}
                  name="2024"
                />
                <Bar
                  dataKey="2025"
                  fill={YEAR_COLORS["2025"]}
                  radius={[2, 2, 0, 0]}
                  name="2025"
                />
                <Bar
                  dataKey="2026"
                  fill={YEAR_COLORS["2026"]}
                  radius={[2, 2, 0, 0]}
                  name="2026"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* ── Monthly Revenue Comparison Chart ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="glass-card rounded-2xl p-6"
        >
          <h3 className="text-lg font-semibold font-display mb-1">
            Recaudación Mensual — Comparativo
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Monto total recaudado por mes (MXN)
          </p>
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={amountChartData}
                margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  tickFormatter={(v) => formatCompact(v)}
                />
                <Tooltip
                  content={
                    <CustomTooltip
                      format="currency"
                      labels={{
                        "2024": "2024",
                        "2025": "2025",
                        "2026": "2026",
                      }}
                    />
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
                />
                <Bar
                  dataKey="2024"
                  fill={YEAR_COLORS["2024"]}
                  radius={[2, 2, 0, 0]}
                  name="2024"
                />
                <Bar
                  dataKey="2025"
                  fill={YEAR_COLORS["2025"]}
                  radius={[2, 2, 0, 0]}
                  name="2025"
                />
                <Bar
                  dataKey="2026"
                  fill={YEAR_COLORS["2026"]}
                  radius={[2, 2, 0, 0]}
                  name="2026"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* ── Pagos por tipo de fuente (solo DataMapping) ── */}
        {dataSource === "datamapping" && (
          <AnnualPaymentBySourceSection data={annualPaymentBySource} />
        )}

        {/* ── Cumulative Charts ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cumulative Events */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="glass-card rounded-2xl p-6"
          >
            <h3 className="text-lg font-semibold font-display mb-1">
              Pagos Acumulados
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Evolución acumulada mes a mes
            </p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={cumulativeChartData}
                  margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                >
                  <defs>
                    {Object.entries(YEAR_COLORS).map(([y, color]) => (
                      <linearGradient
                        key={y}
                        id={`gradCum${y}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={color}
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor={color}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <Tooltip
                    content={
                      <CustomTooltip
                        labels={{
                          "2024": "2024",
                          "2025": "2025",
                          "2026": "2026",
                        }}
                      />
                    }
                  />
                  {Object.entries(YEAR_COLORS).map(([y, color]) => (
                    <Area
                      key={y}
                      type="monotone"
                      dataKey={y}
                      stroke={color}
                      fill={`url(#gradCum${y})`}
                      strokeWidth={2}
                      dot={false}
                      name={y}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Cumulative Revenue */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="glass-card rounded-2xl p-6"
          >
            <h3 className="text-lg font-semibold font-display mb-1">
              Recaudación Acumulada
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Evolución acumulada de monto recaudado
            </p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={cumulativeAmountData}
                  margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                >
                  <defs>
                    {Object.entries(YEAR_COLORS).map(([y, color]) => (
                      <linearGradient
                        key={y}
                        id={`gradCumAmt${y}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={color}
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor={color}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    tickFormatter={(v) => formatCompact(v)}
                  />
                  <Tooltip
                    content={
                      <CustomTooltip
                        format="currency"
                        labels={{
                          "2024": "2024",
                          "2025": "2025",
                          "2026": "2026",
                        }}
                      />
                    }
                  />
                  {Object.entries(YEAR_COLORS).map(([y, color]) => (
                    <Area
                      key={y}
                      type="monotone"
                      dataKey={y}
                      stroke={color}
                      fill={`url(#gradCumAmt${y})`}
                      strokeWidth={2}
                      dot={false}
                      name={y}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>

        {/* ── Monthly Breakdown Table ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="glass-card rounded-2xl p-6 overflow-x-auto"
        >
          <h3 className="text-lg font-semibold font-display mb-4">
            Desglose Mensual Detallado
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left py-3 px-3 text-slate-400 font-medium">
                  Mes
                </th>
                {(["2024", "2025", "2026"] as const).map((y) => (
                  <th
                    key={`${y}-events`}
                    className="text-right py-3 px-3 font-medium"
                    style={{ color: YEAR_COLORS[y] }}
                  >
                    Pagos {y}
                  </th>
                ))}
                {(["2024", "2025", "2026"] as const).map((y) => (
                  <th
                    key={`${y}-amount`}
                    className="text-right py-3 px-3 font-medium hidden lg:table-cell"
                    style={{ color: YEAR_COLORS[y] }}
                  >
                    Monto {y}
                  </th>
                ))}
                <th className="text-right py-3 px-3 text-slate-400 font-medium">
                  Δ 25→26
                </th>
              </tr>
            </thead>
            <tbody>
              {monthlyBreakdown.map((row) => {
                const delta25to26 =
                  row["2025_events"] > 0
                    ? ((row["2026_events"] - row["2025_events"]) /
                        row["2025_events"]) *
                      100
                    : 0;
                const hasData2026 = row["2026_events"] > 0;
                return (
                  <tr
                    key={row.month}
                    className={`border-b border-slate-800/50 transition-colors ${hasData2026 ? "hover:bg-slate-800/30" : "opacity-50"}`}
                  >
                    <td className="py-2.5 px-3 font-medium">
                      {MONTH_NAMES[row.month]}
                    </td>
                    {(["2024", "2025", "2026"] as const).map((y) => (
                      <td
                        key={`${y}-e`}
                        className="text-right py-2.5 px-3 tabular-nums"
                      >
                        {formatNumber(
                          row[
                            `${y}_events` as keyof typeof row
                          ] as number
                        )}
                      </td>
                    ))}
                    {(["2024", "2025", "2026"] as const).map((y) => (
                      <td
                        key={`${y}-a`}
                        className="text-right py-2.5 px-3 tabular-nums hidden lg:table-cell"
                      >
                        {formatCurrency(
                          row[
                            `${y}_amount` as keyof typeof row
                          ] as number
                        )}
                      </td>
                    ))}
                    <td className="text-right py-2.5 px-3">
                      {hasData2026 && row["2025_events"] > 0 ? (
                        <span
                          className={`text-xs font-bold ${delta25to26 >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                        >
                          {delta25to26 >= 0 ? "+" : ""}
                          {delta25to26.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="border-t-2 border-slate-600 font-bold">
                <td className="py-3 px-3">Total</td>
                {(["2024", "2025", "2026"] as const).map((y) => (
                  <td
                    key={`tot-${y}-e`}
                    className="text-right py-3 px-3 tabular-nums"
                    style={{ color: YEAR_COLORS[y] }}
                  >
                    {formatNumber(annualKPIs[y]?.events ?? 0)}
                  </td>
                ))}
                {(["2024", "2025", "2026"] as const).map((y) => (
                  <td
                    key={`tot-${y}-a`}
                    className="text-right py-3 px-3 tabular-nums hidden lg:table-cell"
                    style={{ color: YEAR_COLORS[y] }}
                  >
                    {formatCurrency(annualKPIs[y]?.totalAmount ?? 0)}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </motion.div>

        {/* ── Ticket Promedio Comparison ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="glass-card rounded-2xl p-6"
        >
          <h3 className="text-lg font-semibold font-display mb-1">
            Ticket Promedio por Mes
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Monto promedio por transacción (recaudación / pagos)
          </p>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData.map((row) => ({
                  month: row.month,
                  "2024":
                    row["2024"] > 0
                      ? Math.round(row["2024_amount"] / row["2024"])
                      : 0,
                  "2025":
                    row["2025"] > 0
                      ? Math.round(row["2025_amount"] / row["2025"])
                      : 0,
                  "2026":
                    row["2026"] > 0
                      ? Math.round(row["2026_amount"] / row["2026"])
                      : 0,
                }))}
                margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  content={
                    <CustomTooltip
                      format="currency"
                      labels={{
                        "2024": "2024",
                        "2025": "2025",
                        "2026": "2026",
                      }}
                    />
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
                />
                {Object.entries(YEAR_COLORS).map(([y, color]) => (
                  <Line
                    key={y}
                    type="monotone"
                    dataKey={y}
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: color }}
                    name={y}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* ── Footer ── */}
        <footer className="text-center py-8 border-t border-slate-800 mt-8">
          <p className="text-slate-400 text-sm font-medium font-display">
            Portal de Pagos · Análisis Anual Comparativo
          </p>
          <p className="text-slate-600 text-xs mt-1">
            © 2026 · La información presentada es para fines de análisis
            interno.
          </p>
        </footer>
      </div>
    </div>
  );
}
