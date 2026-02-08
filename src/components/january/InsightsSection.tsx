"use client";

import { useMemo, memo } from "react";
import { motion } from "framer-motion";
import { Lightbulb, TrendingUp, Target, DollarSign, BarChart3 } from "lucide-react";
import { useGetMovementDescription } from "@/hooks/useMovementDescription";

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export interface InsightsSectionProps {
  total: number;
  dailyAvg: number;
  lastDay: number;
  historicalData?: Array<Record<string, number>>;
  topMovements?: Array<{ movimiento: string; totalAmount: number; count: number }>;
  totalAmount?: number;
  yearKey?: string;
  monthLabel?: string;
}

export const InsightsSection = memo(({
  total, // Passed by parent for consistency; reserved for future insights
  dailyAvg,
  lastDay,
  historicalData,
  topMovements,
  totalAmount,
  yearKey = "2026",
  monthLabel = "enero 2026",
}: InsightsSectionProps): React.ReactElement => {
  const getDescription = useGetMovementDescription();
  const insights = useMemo(() => {
    const result: Array<{
      icon: typeof Target;
      title: string;
      text: string;
      accentClass: string;
    }> = [];

    // 1. Arranque del mes - data-driven
    if (historicalData && historicalData.length > 0) {
      const first7 = historicalData
        .filter((d) => d.day <= 7)
        .reduce((s, d) => s + ((d as Record<string, number>)[yearKey] ?? 0), 0);
      const last7 = historicalData
        .filter((d) => d.day >= lastDay - 6)
        .reduce((s, d) => s + ((d as Record<string, number>)[yearKey] ?? 0), 0);

      if (first7 > 0) {
        const growthTrend = (((last7 - first7) / first7) * 100).toFixed(0);
        const trendDirection = last7 >= first7 ? "ascendente" : "descendente";
        const trendSign = last7 >= first7 ? "+" : "";
        result.push({
          icon: Target,
          title: last7 >= first7 ? "Arranque Acelerado" : "Desaceleración",
          text: `Los primeros 7 días registraron ${formatNumber(first7)} pagos. La última semana tuvo ${formatNumber(last7)} pagos, un ${trendSign}${growthTrend}% de cambio intra-mes, indicando tendencia ${trendDirection}.`,
          accentClass: "border-emerald-500/30 bg-emerald-500/5",
        });
      }
    }

    // 2. Promedio diario
    if (historicalData && historicalData.length > 0 && dailyAvg > 0) {
      const daysAboveAvg = historicalData.filter(
        (d) => ((d as Record<string, number>)[yearKey] ?? 0) > dailyAvg
      ).length;
      result.push({
        icon: TrendingUp,
        title: "Promedio Diario",
        text: `El promedio diario fue de ${formatNumber(dailyAvg)} pagos/día. En ${daysAboveAvg} de ${lastDay} días, el volumen superó el promedio.`,
        accentClass: "border-violet-500/30 bg-violet-500/5",
      });
    } else {
      result.push({
        icon: TrendingUp,
        title: "Promedio Diario",
        text: `Promedio de ${formatNumber(dailyAvg)} pagos/día en ${monthLabel}.`,
        accentClass: "border-violet-500/30 bg-violet-500/5",
      });
    }

    // 3. Volumen vs. Monto: Refrendo mayor volumen, Nómina mayor monto
    if (topMovements && topMovements.length > 0 && totalAmount && totalAmount > 0) {
      const byVolume = [...topMovements].sort((a, b) => b.count - a.count);
      const byAmount = [...topMovements].sort((a, b) => b.totalAmount - a.totalAmount);
      const topVolume = byVolume[0];
      const topAmount = byAmount[0];

      if (topVolume && topAmount) {
        const volLabel = getDescription(topVolume.movimiento);
        const amtLabel = getDescription(topAmount.movimiento);

        result.push({
          icon: BarChart3,
          title: "Volumen vs. Recaudación",
          text: `El ${volLabel} es el trámite de mayor volumen con ${formatNumber(topVolume.count)} pagos, mientras que el ${amtLabel} genera el mayor monto con ${formatCurrency(topAmount.totalAmount)}.`,
          accentClass: "border-cyan-500/30 bg-cyan-500/5",
        });
      }
    }

    // 4. Concentración de ingresos
    if (topMovements && topMovements.length > 0 && totalAmount && totalAmount > 0) {
      const top3 = topMovements.slice(0, 3);
      const top3Amount = top3.reduce((s, m) => s + m.totalAmount, 0);
      const top3Pct = ((top3Amount / totalAmount) * 100).toFixed(0);
      const leader = top3[0];
      const leaderPct = ((leader.totalAmount / totalAmount) * 100).toFixed(0);
      const leaderLabel = getDescription(leader.movimiento);

      result.push({
        icon: DollarSign,
        title: "Concentración de Ingresos",
        text: `El Top 3 de tipos de trámite concentra el ${top3Pct}% del ingreso total. ${leaderLabel} lidera con ${formatCurrency(leader.totalAmount)} (${leaderPct}% del total).`,
        accentClass: "border-amber-500/30 bg-amber-500/5",
      });
    }

    // 5. Fallback if no data-driven insights
    if (result.length === 0) {
      result.push({
        icon: Lightbulb,
        title: "Resumen",
        text: `Datos de ${monthLabel} procesados desde paymentRecords. ${formatNumber(total)} pagos en total.`,
        accentClass: "border-slate-500/30 bg-slate-500/5",
      });
    }

    return result;
  }, [total, dailyAvg, lastDay, historicalData, topMovements, totalAmount, getDescription, yearKey, monthLabel]);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="glass-card rounded-2xl p-6 min-w-0"
    >
      <h3 className="text-lg font-semibold font-display mb-4">Insights automáticos</h3>
      <div className="space-y-4">
        {insights.map((item, i) => (
          <div
            key={i}
            className={`flex gap-3 p-4 rounded-xl border ${item.accentClass}`}
          >
            <item.icon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold mb-1">{item.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-slate-700/30">
        Resumen generado con datos hasta día <strong>{lastDay}</strong> de {monthLabel}.
      </p>
    </motion.section>
  );
});

InsightsSection.displayName = "InsightsSection";
