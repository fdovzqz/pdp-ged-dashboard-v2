"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
  ANALYSIS_MONTH_STRING,
  MONTH_NAMES,
  getMonthLabel,
  getMonthShortName,
  getPdfFilename,
  getPdfTitle,
} from "@/lib/constants";
import {
  ContextHeader,
  MonthYearSelector,
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

function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y ?? 2026, month: m ?? 1 };
}

export function DashboardContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<number | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("events");
  const [showYearComparison, setShowYearComparison] = useState(false);

  const monthKeyFromUrl = searchParams.get("month") ?? ANALYSIS_MONTH_STRING;
  const { year: selectedYear, month: selectedMonth } = parseMonthKey(monthKeyFromUrl);

  const [monthKey, setMonthKey] = useState(monthKeyFromUrl);

  useEffect(() => {
    setMonthKey(monthKeyFromUrl);
  }, [monthKeyFromUrl]);

  const handleMonthChange = useCallback(
    (key: string) => {
      setMonthKey(key);
      const url = new URL(window.location.href);
      url.searchParams.set("month", key);
      window.history.replaceState({}, "", url.toString());
    },
    []
  );

  const monthLabel = getMonthLabel(selectedYear, selectedMonth);
  const yearKey = String(selectedYear);

  /* ──────── Queries ──────── */
  const historicalData = useQuery(api.januaryQueries.getHistoricalData, {
    month: selectedMonth,
  });
  const lastAvailableDay =
    useQuery(api.januaryQueries.getLastAvailableDay, { month: selectedMonth }) ?? 0;
  const totals = useQuery(api.januaryQueries.getTotals, { month: selectedMonth }) ?? {
    [yearKey]: 0,
  };
  const totalsUpToDay =
    useQuery(api.januaryQueries.getTotalsUpToDay, {
      maxDay: lastAvailableDay,
      month: selectedMonth,
    }) ?? totals;
  const totalsAndAmountsUpToDay = useQuery(
    api.januaryQueries.getTotalsAndAmountsUpToDay,
    { maxDay: lastAvailableDay, month: selectedMonth }
  );
  const dailyAverages =
    useQuery(api.januaryQueries.getDailyAverages, { month: selectedMonth }) ?? {
      [yearKey]: 0,
    };
  const historicalMax =
    useQuery(api.januaryQueries.getHistoricalMax, { month: selectedMonth }) ?? {
      value: 0,
      day: 0,
      year: 0,
    };
  const hourlyDistWeekday = useQuery(api.januaryQueries.getHourlyDistribution, {
    month: selectedMonth,
    dayType: "weekday",
  });
  const hourlyDistWeekend = useQuery(api.januaryQueries.getHourlyDistribution, {
    month: selectedMonth,
    dayType: "weekend",
  });
  const heatmapData = useQuery(api.januaryQueries.getHeatmapAmountData, {
    year: selectedYear,
    month: selectedMonth,
  });
  const weekdayWeekend =
    useQuery(api.januaryQueries.getWeekdayWeekendStats, { month: selectedMonth }) ?? [];
  const weekdayWeekendAmounts =
    useQuery(api.januaryQueries.getWeekdayWeekendStatsWithAmounts, {
      month: selectedMonth,
    }) ?? [];
  const periodStats =
    useQuery(api.januaryQueries.getPeriodStats, { month: selectedMonth }) ?? [];
  const analysisNotes = useQuery(api.januaryQueries.getAnalysisNotes) ?? [];
  const amountTotals = useQuery(api.januaryQueries.getAmountTotals, {
    month: selectedMonth,
  });
  const amountByMovement =
    useQuery(api.januaryQueries.getAmountByMovement, {
      year: selectedYear,
      month: selectedMonth,
    }) ?? [];
  const paymentChannels = useQuery(api.januaryQueries.getPaymentChannelStats, {
    month: selectedMonth,
    year: selectedYear,
  });
  const dailyAmountData = useQuery(api.januaryQueries.getDailyAmountData, {
    year: selectedYear,
    month: selectedMonth,
  });

  const dayDetailSelected = useQuery(
    api.januaryQueries.getDayDetail,
    selectedHeatmapDay !== null
      ? { year: selectedYear, month: selectedMonth, day: selectedHeatmapDay }
      : "skip"
  );
  const dayFinancialSelected = useQuery(
    api.januaryQueries.getDayFinancialDetail,
    selectedHeatmapDay !== null
      ? { year: selectedYear, month: selectedMonth, day: selectedHeatmapDay }
      : "skip"
  );

  const handleDayClick = (day: number): void => {
    setSelectedHeatmapDay(day);
  };

  const sparklinePagos = useMemo(() => {
    if (!historicalData) return undefined;
    return historicalData.map((r) => (r as Record<string, number>)[yearKey] ?? 0);
  }, [historicalData, yearKey]);

  const sparklineMontos = useMemo(() => {
    if (!dailyAmountData) return undefined;
    return dailyAmountData.map((d) => d.totalAmount);
  }, [dailyAmountData]);

  const trendInfo = useMemo(() => {
    if (!historicalData || historicalData.length < 10) return undefined;
    const mid = Math.floor(historicalData.length / 2);
    const first = historicalData.slice(0, mid).reduce((s, d) => s + ((d as Record<string, number>)[yearKey] ?? 0), 0);
    const second = historicalData.slice(mid).reduce((s, d) => s + ((d as Record<string, number>)[yearKey] ?? 0), 0);
    if (first <= 0) return undefined;
    const pct = ((second - first) / first) * 100;
    return { pct: Number(pct.toFixed(1)), delta: second - first };
  }, [historicalData, yearKey]);

  const isLoading = historicalData === undefined;
  const totalYear = totals[yearKey] ?? 0;
  const avgYear = dailyAverages[yearKey] ?? 0;
  const vYear = amountTotals?.[yearKey] ?? { totalAmount: 0, ticketPromedio: 0, events: 0 };
  const totalsYear = totalsAndAmountsUpToDay?.[yearKey] ?? {
    events: totalYear,
    totalAmount: vYear.totalAmount,
  };

  const periodYear = periodStats.find((p) => p.year === yearKey);
  const periods = periodYear
    ? {
        arranque: periodYear.arranque,
        medio: periodYear.medio,
        cierre: periodYear.cierre,
        arranqueAmount: periodYear.arranqueAmount ?? 0,
        medioAmount: periodYear.medioAmount ?? 0,
        cierreAmount: periodYear.cierreAmount ?? 0,
      }
    : undefined;

  const wwYear = weekdayWeekend.find((w) => w.year === yearKey);
  const wwAmountsYear = weekdayWeekendAmounts.find((w) => w.year === yearKey);

  const weekdayHourly = useMemo(() => {
    if (!hourlyDistWeekday) return undefined;
    return hourlyDistWeekday.map((h) => ({
      hour: h.hour,
      value: (h as Record<string, number>)[yearKey] ?? 0,
    }));
  }, [hourlyDistWeekday, yearKey]);

  const weekendHourly = useMemo(() => {
    if (!hourlyDistWeekend) return undefined;
    return hourlyDistWeekend.map((h) => ({
      hour: h.hour,
      value: (h as Record<string, number>)[yearKey] ?? 0,
    }));
  }, [hourlyDistWeekend, yearKey]);

  const selectedDayData = useMemo(() => {
    if (!selectedHeatmapDay || !dayDetailSelected?.[yearKey]) return null;
    const hourly = dayDetailSelected[yearKey].map((h) => ({
      hour: h.hour,
      events: h.events,
      totalAmount: h.totalAmount ?? 0,
    }));
    const row = historicalData?.find((r) => r.day === selectedHeatmapDay);
    const pagos = (row as Record<string, number> | undefined)?.[yearKey] ?? 0;
    const financial = dayFinancialSelected;
    return {
      day: selectedHeatmapDay,
      hourly,
      pagos,
      totalAmount: financial?.totalAmount ?? 0,
      ticketPromedio: financial?.ticketPromedio ?? 0,
    };
  }, [selectedHeatmapDay, dayDetailSelected, dayFinancialSelected, historicalData, yearKey]);

  const handleExportPdf = useCallback(async (): Promise<void> => {
    await exportDashboardToPdf({
      elementId: "january-dashboard-content",
      filename: getPdfFilename(selectedYear, selectedMonth),
      title: getPdfTitle(selectedYear, selectedMonth),
      financialSummary: {
        totalAmount: vYear.totalAmount,
        ticketPromedio: vYear.ticketPromedio,
      },
    });
  }, [selectedYear, selectedMonth, vYear.totalAmount, vYear.ticketPromedio]);

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
          title={`Análisis Completo: ${monthLabel}`}
          description="Dashboard ejecutivo con datos de pagos, montos y tipos de movimiento. Clic en el calendario para ver la distribución horaria del día."
          lastAvailableDay={lastAvailableDay}
          onExportPdf={handleExportPdf}
          monthLabel={monthLabel}
          monthShortName={getMonthShortName(selectedMonth)}
          selectedYear={selectedYear}
          monthSelector={
            <MonthYearSelector value={monthKey} onChange={handleMonthChange} />
          }
        />

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          initial="hidden"
          animate="visible"
          variants={kpiGridVariants}
        >
          <KPICard
            value={totalYear}
            subtitle={`Total Pagos (1–${lastAvailableDay})`}
            icon={CreditCard}
            accent
            trend={trendInfo?.pct}
            trendDelta={trendInfo?.delta}
            sparklineData={sparklinePagos}
            tooltip="Tendencia del mes completo"
          />
          <KPICard
            value={vYear.totalAmount}
            subtitle={`Recaudación ${monthLabel.toLowerCase()}`}
            icon={DollarSign}
            format="currency"
            sparklineData={sparklineMontos}
            tooltip="Montos por día del mes"
          />
          <KPICard
            value={vYear.ticketPromedio}
            subtitle="Monto promedio / transacción"
            icon={TrendingUp}
            format="currency"
            tooltip="Ticket promedio por transacción"
          />
          <KPICard
            value={historicalMax.value}
            subtitle={`Día de mayor volumen · ${historicalMax.day} ${getMonthShortName(selectedMonth)} ${historicalMax.year}`}
            icon={Award}
            tooltip="Máximo histórico en un solo día"
          />
        </motion.div>

        <HistoricalChart
          data={historicalData}
          dailyAmountData={dailyAmountData}
          dailyAverage={avgYear}
          yearKey={yearKey}
          dailyAverageAmount={
            dailyAmountData && dailyAmountData.length > 0
              ? Math.round(
                  dailyAmountData.reduce((s, d) => s + d.totalAmount, 0) /
                    dailyAmountData.length
                )
              : undefined
          }
          onDaySelect={(day) => handleDayClick(day)}
          showComparison={showYearComparison}
          onToggleComparison={setShowYearComparison}
        />

        <AccumulatedSection
          total={totalsUpToDay[yearKey] ?? 0}
          totalAmount={totalsYear.totalAmount}
          lastAvailableDay={lastAvailableDay}
          periods={periods}
          monthLabel={monthLabel.toLowerCase()}
        />

        <PaymentChannelsSection data={paymentChannels} />

        <StatsSection
          weekday={wwYear?.weekday ?? 0}
          weekend={wwYear?.weekend ?? 0}
          weekdayAmount={wwAmountsYear?.weekdayAmount ?? 0}
          weekendAmount={wwAmountsYear?.weekendAmount ?? 0}
          arranque={periodYear?.arranque ?? 0}
          medio={periodYear?.medio ?? 0}
          cierre={periodYear?.cierre ?? 0}
          arranqueAmount={periodYear?.arranqueAmount ?? 0}
          medioAmount={periodYear?.medioAmount ?? 0}
          cierreAmount={periodYear?.cierreAmount ?? 0}
          total={totalYear}
          totalAmount={vYear.totalAmount}
        />

        {/* Heatmap primero, luego Distribución horaria */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <HeatmapChart
            data={heatmapData}
            selectedDay={selectedHeatmapDay}
            onDayClick={(day) => handleDayClick(day)}
            mode={calendarMode}
            onModeChange={setCalendarMode}
            month={selectedMonth}
            year={selectedYear}
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
          yearKey={yearKey}
        />

        {/* Notas e Insights después del resumen financiero */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <NotesSection
            notes={analysisNotes}
            lastAvailableDay={lastAvailableDay}
            monthName={MONTH_NAMES[selectedMonth] ?? `Mes ${selectedMonth}`}
          />
          <InsightsSection
            total={totalYear}
            dailyAvg={avgYear}
            lastDay={lastAvailableDay}
            historicalData={historicalData}
            topMovements={amountByMovement}
            totalAmount={vYear.totalAmount}
            yearKey={yearKey}
            monthLabel={monthLabel.toLowerCase()}
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
