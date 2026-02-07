"use client";

import { useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, DollarSign } from "lucide-react";
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

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export interface DayDetailModalProps {
  open: boolean;
  onClose: () => void;
  day: number;
  year: number;
  month: number;
  totalPagos?: number;
  hourlyData?: Array<{ hour: number; events: number; cumulative: number; totalAmount?: number }>;
  dayFinancial?: {
    totalAmount: number;
    totalEvents: number;
    ticketPromedio: number;
  };
  monthTicketPromedio?: number;
}

export const DayDetailModal = memo(({
  open,
  onClose,
  day,
  year,
  month,
  totalPagos = 0,
  hourlyData = [],
  dayFinancial,
  monthTicketPromedio = 0,
}: DayDetailModalProps): React.ReactElement => {
  const [showHourly, setShowHourly] = useState(false);

  const monthLabel = month === 1 ? "Enero" : `Mes ${month}`;

  const ticketDiff = useMemo(() => {
    if (!dayFinancial || monthTicketPromedio <= 0) return null;
    const diff = dayFinancial.ticketPromedio - monthTicketPromedio;
    const pct = ((diff / monthTicketPromedio) * 100).toFixed(0);
    return { diff, pct, sign: diff >= 0 ? "+" : "" };
  }, [dayFinancial, monthTicketPromedio]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop with blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[90vh] overflow-y-auto z-50 rounded-2xl bg-slate-900 border border-slate-700/50 shadow-2xl"
          >
            <div className="p-6 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold font-display">
                  {day} de {monthLabel} {year}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              {/* Mini card: total del día */}
              <div className="rounded-xl bg-emerald-500/10 p-4 border border-emerald-500/20">
                <p className="text-3xl font-bold tabular-nums text-emerald-400">
                  {formatNumber(totalPagos)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  pagos el día {day}
                </p>
              </div>

              {/* Financial info */}
              {dayFinancial && dayFinancial.totalAmount > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-800/50 border border-slate-700/30 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="w-4 h-4 text-amber-400" />
                      <p className="text-xs text-slate-400">Recaudación</p>
                    </div>
                    <p className="text-lg font-bold tabular-nums">
                      {formatCurrency(dayFinancial.totalAmount)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-800/50 border border-slate-700/30 p-4">
                    <p className="text-xs text-slate-400 mb-1">Ticket promedio</p>
                    <p className="text-lg font-bold tabular-nums">
                      {formatCurrency(dayFinancial.ticketPromedio)}
                    </p>
                    {ticketDiff && (
                      <p className={`text-xs mt-1 ${Number(ticketDiff.pct) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {ticketDiff.sign}{ticketDiff.pct}% vs promedio mes
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Toggle button for hourly */}
              <button
                type="button"
                onClick={() => setShowHourly(!showHourly)}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:bg-slate-800/60 transition-colors text-sm font-medium"
              >
                <span>{showHourly ? "Ocultar intradía" : "Mostrar intradía"}</span>
                <ChevronRight
                  className={`w-4 h-4 text-slate-400 transition-transform ${showHourly ? "rotate-90" : ""}`}
                />
              </button>

              {/* Hourly chart */}
              <AnimatePresence>
                {showHourly && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="h-[240px]">
                      {hourlyData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={hourlyData}
                            margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="rgba(255,255,255,0.05)"
                            />
                            <XAxis
                              dataKey="hour"
                              tick={{ fill: "#94a3b8", fontSize: 12 }}
                              tickFormatter={(h) => `${h}h`}
                            />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                            <Tooltip
                              content={<CustomTooltip labels={{ events: "Pagos" }} />}
                            />
                            <Bar dataKey="events" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="text-sm text-muted-foreground h-full flex items-center justify-center">
                          No hay datos horarios para este día
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

DayDetailModal.displayName = "DayDetailModal";
