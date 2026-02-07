"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { motion } from "framer-motion";
import {
  CreditCard,
  DollarSign,
  TrendingUp,
  Award,
} from "lucide-react";
import { exportDashboardToPdf } from "@/lib/exportPdf";
import {
  ANALYSIS_MONTH,
  ANALYSIS_YEAR,
  PDF_FILENAME,
  PDF_TITLE,
  ANALYSIS_MONTH_LABEL,
} from "@/lib/constants";
import {
  ContextHeader,
  KPICard,
  kpiGridVariants,
  HistoricalChart,
  HourlyChart,
  HeatmapChart,
  AccumulatedSection,
  StatsSection,
  NotesSection,
  InsightsSection,
  FinancialSummary,
  DashboardSkeleton,
  TicketEvolutionChart,
  PaymentChannelsSection,
} from "@/components/january";

export type CalendarMode = "events" | "amount";

export default function Home(): React.ReactElement {
  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<number | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("events");

  /* ──────── Queries ──────── */
  const historicalData = useQuery(api.januaryQueries.getHistoricalData, {
    month: ANALYSIS_MONTH,
  });
  const lastAvailableDay =
    useQuery(api.januaryQueries.getLastAvailableDay, { month: ANALYSIS_MONTH }) ?? 0;
  const totals = useQuery(api.januaryQueries.getTotals, { month: ANALYSIS_MONTH }) ?? {
    "2026": 0,
  };
  const totalsUpToDay =
    useQuery(api.januaryQueries.getTotalsUpToDay, {
      maxDay: lastAvailableDay,
      month: ANALYSIS_MONTH,
    }) ?? totals;
  const totalsAndAmountsUpToDay = useQuery(
    api.januaryQueries.getTotalsAndAmountsUpToDay,
    { maxDay: lastAvailableDay, month: ANALYSIS_MONTH }
  );
  const dailyAverages =
    useQuery(api.januaryQueries.getDailyAverages, { month: ANALYSIS_MONTH }) ?? {
      "2026": 0,
    };
  const historicalMax =
    useQuery(api.januaryQueries.getHistoricalMax, { month: ANALYSIS_MONTH }) ?? {
      value: 0,
      day: 0,
      year: 0,
    };
  const hourlyDistWeekday = useQuery(api.januaryQueries.getHourlyDistribution, {
    month: ANALYSIS_MONTH,
    dayType: "weekday",
  });
  const hourlyDistWeekend = useQuery(api.januaryQueries.getHourlyDistribution, {
    month: ANALYSIS_MONTH,
    dayType: "weekend",
  });
  const heatmapData = useQuery(api.januaryQueries.getHeatmapAmountData, {
    year: ANALYSIS_YEAR,
    month: ANALYSIS_MONTH,
  });
  const weekdayWeekend =
    useQuery(api.januaryQueries.getWeekdayWeekendStats, { month: ANALYSIS_MONTH }) ?? [];
  const weekdayWeekendAmounts =
    useQuery(api.januaryQueries.getWeekdayWeekendStatsWithAmounts, {
      month: ANALYSIS_MONTH,
    }) ?? [];
  const periodStats =
    useQuery(api.januaryQueries.getPeriodStats, { month: ANALYSIS_MONTH }) ?? [];
  const analysisNotes = useQuery(api.januaryQueries.getAnalysisNotes) ?? [];
  const amountTotals = useQuery(api.januaryQueries.getAmountTotals, {
    month: ANALYSIS_MONTH,
  });
  const amountByMovement =
    useQuery(api.januaryQueries.getAmountByMovement, {
      year: ANALYSIS_YEAR,
      month: ANALYSIS_MONTH,
    }) ?? [];
  const paymentChannels = useQuery(api.januaryQueries.getPaymentChannelStats, {
    month: ANALYSIS_MONTH,
  });
  const dailyAmountData = useQuery(api.januaryQueries.getDailyAmountData, {
    year: ANALYSIS_YEAR,
    month: ANALYSIS_MONTH,
  });

  const dayDetailSelected = useQuery(
    api.januaryQueries.getDayDetail,
    selectedHeatmapDay !== null
      ? { year: ANALYSIS_YEAR, month: ANALYSIS_MONTH, day: selectedHeatmapDay }
      : "skip"
  );
  const dayFinancialSelected = useQuery(
    api.januaryQueries.getDayFinancialDetail,
    selectedHeatmapDay !== null
      ? { year: ANALYSIS_YEAR, month: ANALYSIS_MONTH, day: selectedHeatmapDay }
      : "skip"
  );

  const handleDayClick = (day: number): void => {
    setSelectedHeatmapDay(day);
  };

  const sparklinePagos = useMemo(() => {
    if (!historicalData) return undefined;
    return historicalData.map((r) => r["2026"] ?? 0);
  }, [historicalData]);

  const sparklineMontos = useMemo(() => {
    if (!dailyAmountData) return undefined;
    return dailyAmountData.map((d) => d.totalAmount);
  }, [dailyAmountData]);

  const trendInfo = useMemo(() => {
    if (!historicalData || historicalData.length < 10) return undefined;
    const mid = Math.floor(historicalData.length / 2);
    const first = historicalData.slice(0, mid).reduce((s, d) => s + (d["2026"] ?? 0), 0);
    const second = historicalData.slice(mid).reduce((s, d) => s + (d["2026"] ?? 0), 0);
    if (first <= 0) return undefined;
    const pct = ((second - first) / first) * 100;
    return { pct: Number(pct.toFixed(1)), delta: second - first };
  }, [historicalData]);

  const isLoading = historicalData === undefined;
  const total2026 = totals["2026"] ?? 0;
  const avg2026 = dailyAverages["2026"] ?? 0;
  const v2026 = amountTotals?.["2026"] ?? { totalAmount: 0, ticketPromedio: 0, events: 0 };
  const totals2026 = totalsAndAmountsUpToDay?.["2026"] ?? {
    events: total2026,
    totalAmount: v2026.totalAmount,
  };

  const period2026 = periodStats.find((p) => p.year === "2026");
  const periods = period2026
    ? {
        arranque: period2026.arranque,
        medio: period2026.medio,
        cierre: period2026.cierre,
        arranqueAmount: period2026.arranqueAmount ?? 0,
        medioAmount: period2026.medioAmount ?? 0,
        cierreAmount: period2026.cierreAmount ?? 0,
      }
    : undefined;

  const ww2026 = weekdayWeekend.find((w) => w.year === "2026");
  const wwAmounts2026 = weekdayWeekendAmounts.find((w) => w.year === "2026");

  const weekdayHourly = useMemo(() => {
    if (!hourlyDistWeekday) return undefined;
    return hourlyDistWeekday.map((h) => ({
      hour: h.hour,
      value: h["2026"] ?? 0,
    }));
  }, [hourlyDistWeekday]);

  const weekendHourly = useMemo(() => {
    if (!hourlyDistWeekend) return undefined;
    return hourlyDistWeekend.map((h) => ({
      hour: h.hour,
      value: h["2026"] ?? 0,
    }));
  }, [hourlyDistWeekend]);

  const selectedDayData = useMemo(() => {
    if (!selectedHeatmapDay || !dayDetailSelected?.["2026"]) return null;
    const hourly = dayDetailSelected["2026"].map((h) => ({
      hour: h.hour,
      events: h.events,
      totalAmount: h.totalAmount ?? 0,
    }));
    const row = historicalData?.find((r) => r.day === selectedHeatmapDay);
    const pagos = row?.["2026"] ?? 0;
    const financial = dayFinancialSelected;
    return {
      day: selectedHeatmapDay,
      hourly,
      pagos,
      totalAmount: financial?.totalAmount ?? 0,
      ticketPromedio: financial?.ticketPromedio ?? 0,
    };
  }, [selectedHeatmapDay, dayDetailSelected, dayFinancialSelected, historicalData]);

  const handleExportPdf = useCallback(async (): Promise<void> => {
    await exportDashboardToPdf({
      elementId: "january-dashboard-content",
      filename: PDF_FILENAME,
      title: PDF_TITLE,
      financialSummary: {
        totalAmount: v2026.totalAmount,
        ticketPromedio: v2026.ticketPromedio,
      },
    });
  }, [v2026.totalAmount, v2026.ticketPromedio]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
        <div className="max-w-7xl mx-auto">
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
      <div
        id="january-dashboard-content"
        className="max-w-7xl mx-auto space-y-8"
      >
        <ContextHeader
          title={`Análisis Completo: ${ANALYSIS_MONTH_LABEL}`}
          description="Dashboard ejecutivo con datos de pagos, montos y tipos de movimiento. Clic en el calendario para ver la distribución horaria del día."
          lastAvailableDay={lastAvailableDay}
          onExportPdf={handleExportPdf}
        />

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          initial="hidden"
          animate="visible"
          variants={kpiGridVariants}
        >
          <KPICard
            value={total2026}
            subtitle={`Total Pagos (1–${lastAvailableDay})`}
            icon={CreditCard}
            accent
            trend={trendInfo?.pct}
            trendDelta={trendInfo?.delta}
            sparklineData={sparklinePagos}
            tooltip="Tendencia del mes completo"
          />
          <KPICard
            value={v2026.totalAmount}
            subtitle="Recaudación enero 2026"
            icon={DollarSign}
            format="currency"
            sparklineData={sparklineMontos}
            tooltip="Montos por día del mes"
          />
          <KPICard
            value={v2026.ticketPromedio}
            subtitle="Monto promedio / transacción"
            icon={TrendingUp}
            format="currency"
            tooltip="Ticket promedio por transacción"
          />
          <KPICard
            value={historicalMax.value}
            subtitle={`Día de mayor volumen · ${historicalMax.day} Ene ${historicalMax.year}`}
            icon={Award}
            tooltip="Máximo histórico en un solo día"
          />
        </motion.div>

        <HistoricalChart
          data={historicalData}
          dailyAmountData={dailyAmountData}
          dailyAverage={avg2026}
          dailyAverageAmount={
            dailyAmountData && dailyAmountData.length > 0
              ? Math.round(
                  dailyAmountData.reduce((s, d) => s + d.totalAmount, 0) /
                    dailyAmountData.length
                )
              : undefined
          }
          onDaySelect={(day) => handleDayClick(day)}
        />

        <AccumulatedSection
          total={totalsUpToDay["2026"] ?? 0}
          totalAmount={totals2026.totalAmount}
          lastAvailableDay={lastAvailableDay}
          periods={periods}
        />

        <PaymentChannelsSection data={paymentChannels} />

        <StatsSection
          weekday={ww2026?.weekday ?? 0}
          weekend={ww2026?.weekend ?? 0}
          weekdayAmount={wwAmounts2026?.weekdayAmount ?? 0}
          weekendAmount={wwAmounts2026?.weekendAmount ?? 0}
          arranque={period2026?.arranque ?? 0}
          medio={period2026?.medio ?? 0}
          cierre={period2026?.cierre ?? 0}
          arranqueAmount={period2026?.arranqueAmount ?? 0}
          medioAmount={period2026?.medioAmount ?? 0}
          cierreAmount={period2026?.cierreAmount ?? 0}
          total={total2026}
          totalAmount={v2026.totalAmount}
        />

        {/* Heatmap primero, luego Distribución horaria */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <HeatmapChart
            data={heatmapData}
            selectedDay={selectedHeatmapDay}
            onDayClick={(day) => handleDayClick(day)}
            mode={calendarMode}
            onModeChange={setCalendarMode}
          />
          <HourlyChart
            weekdayData={weekdayHourly}
            weekendData={weekendHourly}
            selectedDayData={selectedDayData}
            onClearSelection={() => setSelectedHeatmapDay(null)}
            calendarMode={calendarMode}
          />
        </div>

        <TicketEvolutionChart data={dailyAmountData} />

        <FinancialSummary
          amountTotals={amountTotals}
          topMovements={amountByMovement}
        />

        {/* Notas e Insights después del resumen financiero */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <NotesSection
            notes={analysisNotes}
            lastAvailableDay={lastAvailableDay}
            monthName="Enero"
          />
          <InsightsSection
            total={total2026}
            dailyAvg={avg2026}
            lastDay={lastAvailableDay}
            historicalData={historicalData}
            topMovements={amountByMovement}
            totalAmount={v2026.totalAmount}
          />
        </div>

        <footer className="text-center py-8 border-t border-slate-800 mt-8">
          <p className="text-slate-400 text-sm font-medium font-display">
            Portal de Pagos · Dashboard Ejecutivo
          </p>
          <p className="text-slate-600 text-xs mt-1">
            © 2026 · La información presentada es para fines de análisis interno.
          </p>
        </footer>
      </div>
    </div>
  );
}
