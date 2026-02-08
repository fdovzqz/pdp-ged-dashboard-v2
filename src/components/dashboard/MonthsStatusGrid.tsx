"use client";

import { motion } from "framer-motion";
import { PERIOD_START, PERIOD_END, generateMonthRange } from "@/lib/constants";

/** Etiquetas cortas de meses en español. */
const MONTH_LABELS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

interface MonthStatus {
  month: string;
  totalRecords: number;
  daysWithData: number;
  lastUpdated: number;
}

interface MonthsStatusGridProps {
  allMonthsStatus: MonthStatus[];
  selectedMonth: string | null;
  onMonthSelect: (month: string | null) => void;
}

export const MonthsStatusGrid = ({
  allMonthsStatus,
  selectedMonth,
  onMonthSelect,
}: MonthsStatusGridProps): React.ReactElement => {
  const statusByMonth = new Map(
    allMonthsStatus.map((s) => [s.month, s])
  );
  const allMonths = generateMonthRange(PERIOD_START, PERIOD_END);
  const maxRecords = Math.max(
    ...allMonthsStatus.map((s) => s.totalRecords),
    1
  );

  /** Agrupar meses por año para filas. */
  const years = new Map<number, string[]>();
  for (const month of allMonths) {
    const year = parseInt(month.slice(0, 4), 10);
    const arr = years.get(year) ?? [];
    arr.push(month);
    years.set(year, arr);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-card rounded-xl p-5"
    >
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Meses con datos
      </p>
      <div className="space-y-2">
        {Array.from(years.entries())
          .sort(([a], [b]) => a - b)
          .map(([year, months]) => (
            <div key={year} className="flex items-center gap-2">
              <span className="w-10 text-xs font-medium text-muted-foreground shrink-0">
                {year}
              </span>
              <div className="flex gap-1 flex-wrap">
                {months.map((month) => {
                  const status = statusByMonth.get(month);
                  const hasData = status && status.totalRecords > 0;
                  const intensity = status
                    ? status.totalRecords / maxRecords
                    : 0;
                  const isSelected = selectedMonth === month;

                  return (
                    <button
                      key={month}
                      type="button"
                      onClick={() =>
                        onMonthSelect(isSelected ? null : month)
                      }
                      title={
                        status
                          ? `${status.totalRecords.toLocaleString()} registros, ${status.daysWithData} días`
                          : "Sin datos"
                      }
                      className={`flex flex-col items-center gap-0.5 min-w-[28px] py-1.5 px-1 rounded-md transition-all hover:scale-105 cursor-pointer border ${
                        isSelected
                          ? "ring-2 ring-indigo-400 border-indigo-400/50"
                          : "border-transparent"
                      }`}
                      style={{
                        backgroundColor: hasData
                          ? `rgba(129, 140, 248, ${0.15 + intensity * 0.5})`
                          : "rgba(100, 116, 139, 0.15)",
                        color: hasData
                          ? "rgba(255,255,255,0.9)"
                          : "rgba(255,255,255,0.35)",
                      }}
                    >
                      <span className="text-[10px] font-medium">
                        {MONTH_LABELS[parseInt(month.slice(5, 7), 10) - 1]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Clic en un mes para ver detalle por día
      </p>
    </motion.div>
  );
};
