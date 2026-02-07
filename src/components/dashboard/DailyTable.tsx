"use client";

import { motion } from "framer-motion";

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

interface DailyTableProps {
  days: DayData[];
}

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const getDayOfWeek = (dateStr: string): number => {
  const d = new Date(dateStr + "T12:00:00");
  return d.getDay();
};

export const DailyTable = ({ days }: DailyTableProps): React.ReactElement => {
  const maxCount = Math.max(...days.map((d) => d.count), 1);
  const totalCount = days.reduce((s, d) => s + d.count, 0);
  const totalMonto = days.reduce((s, d) => s + d.monto, 0);

  return (
    <div className="space-y-4">
      {/* Totals bar */}
      <div className="flex items-center gap-6 text-sm">
        <span className="text-muted-foreground">
          Total: <span className="text-foreground font-semibold tabular-nums">{totalCount.toLocaleString()}</span> pagos
        </span>
        <span className="text-muted-foreground">
          Monto: <span className="text-foreground font-semibold tabular-nums">{formatCurrency(totalMonto)}</span>
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-white/[0.02]">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Fecha</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Pagos</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden sm:table-cell">Monto</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider w-[200px] hidden md:table-cell">Distribuci&oacute;n</th>
              <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-violet-400 hidden lg:table-cell">V1</th>
              <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-blue-400 hidden lg:table-cell">V2</th>
              <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-emerald-400 hidden lg:table-cell">EVO</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => {
              const pct = (day.count / maxCount) * 100;
              const isWeekend = [0, 6].includes(getDayOfWeek(day.date));

              return (
                <motion.tr
                  key={day.date}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02, duration: 0.3 }}
                  className={`border-b border-border/30 hover:bg-white/[0.02] transition-colors ${isWeekend ? "bg-white/[0.01]" : ""}`}
                >
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <span className={isWeekend ? "text-muted-foreground" : ""}>
                      {formatDate(day.date)}
                    </span>
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums font-semibold">
                    {day.count.toLocaleString()}
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-muted-foreground hidden sm:table-cell">
                    {formatCurrency(day.monto)}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden flex">
                      {day.v1 > 0 && (
                        <div
                          className="h-full bg-violet-400"
                          style={{ width: `${(day.v1 / day.count) * pct}%` }}
                        />
                      )}
                      {day.v2 > 0 && (
                        <div
                          className="h-full bg-blue-400"
                          style={{ width: `${(day.v2 / day.count) * pct}%` }}
                        />
                      )}
                      {day.payment > 0 && (
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${(day.payment / day.count) * pct}%` }}
                        />
                      )}
                    </div>
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-violet-400/70 text-xs hidden lg:table-cell">
                    {day.v1 > 0 ? day.v1.toLocaleString() : "—"}
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-blue-400/70 text-xs hidden lg:table-cell">
                    {day.v2 > 0 ? day.v2.toLocaleString() : "—"}
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-emerald-400/70 text-xs hidden lg:table-cell">
                    {day.payment > 0 ? day.payment.toLocaleString() : "—"}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
