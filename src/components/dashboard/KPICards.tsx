"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  DollarSign,
  Hash,
  TrendingUp,
  CalendarDays,
} from "lucide-react";

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);

/** Animated counter hook */
const useAnimatedNumber = (target: number, duration = 1200): number => {
  const [current, setCurrent] = useState(0);
  const ref = useRef<number | null>(null);

  useEffect(() => {
    if (ref.current !== null) cancelAnimationFrame(ref.current);
    const start = performance.now();
    const from = current;

    const step = (now: number): void => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setCurrent(Math.round(from + (target - from) * eased));
      if (progress < 1) ref.current = requestAnimationFrame(step);
    };

    ref.current = requestAnimationFrame(step);
    return () => {
      if (ref.current !== null) cancelAnimationFrame(ref.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return current;
};

interface KPICardsProps {
  totalPagos: number;
  montoTotal: number;
  referenciasUnicas: number;
  promedioDiario: number;
  diasConDatos: number;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

export const KPICards = ({
  totalPagos,
  montoTotal,
  referenciasUnicas,
  promedioDiario,
  diasConDatos,
}: KPICardsProps): React.ReactElement => {
  const animatedMonto = useAnimatedNumber(montoTotal);
  const animatedPagos = useAnimatedNumber(totalPagos);
  const animatedRefs = useAnimatedNumber(referenciasUnicas);
  const animatedPromedio = useAnimatedNumber(promedioDiario);

  return (
    <div className="space-y-6">
      {/* Hero metric - Monto Total Recaudado */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="glass-card-elevated glow-emerald rounded-2xl p-8 relative overflow-hidden"
      >
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-[0.03]">
          <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-400 rounded-full blur-3xl translate-x-1/3 -translate-y-1/3" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-400 rounded-full blur-3xl -translate-x-1/3 translate-y-1/3" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Monto Total Recaudado
              </p>
              <p className="text-xs text-muted-foreground">Enero 2026</p>
            </div>
          </div>
          <div className="flex items-baseline gap-4">
            <span className="text-5xl sm:text-6xl font-bold tracking-tight gradient-text-emerald tabular-nums">
              {formatCurrency(animatedMonto)}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              {diasConDatos} d&iacute;as con datos
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-400" />
              3 fuentes reconciliadas
            </span>
          </div>
        </div>
      </motion.div>

      {/* Secondary KPIs */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid gap-4 grid-cols-2 lg:grid-cols-4"
      >
        {/* Total Pagos */}
        <motion.div variants={item} className="glass-card rounded-xl p-5 group hover:glass-card-elevated transition-all duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 group-hover:bg-indigo-500/15 transition-colors">
              <CreditCard className="w-4 h-4 text-indigo-400" />
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Pagos
            </p>
          </div>
          <p className="text-3xl font-bold tracking-tight tabular-nums">
            {animatedPagos.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Registros procesados</p>
        </motion.div>

        {/* Referencias Unicas */}
        <motion.div variants={item} className="glass-card rounded-xl p-5 group hover:glass-card-elevated transition-all duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 group-hover:bg-violet-500/15 transition-colors">
              <Hash className="w-4 h-4 text-violet-400" />
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Referencias
            </p>
          </div>
          <p className="text-3xl font-bold tracking-tight tabular-nums">
            {animatedRefs.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Sin duplicados</p>
        </motion.div>

        {/* Promedio Diario */}
        <motion.div variants={item} className="glass-card rounded-xl p-5 group hover:glass-card-elevated transition-all duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 group-hover:bg-amber-500/15 transition-colors">
              <TrendingUp className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Promedio Diario
            </p>
          </div>
          <p className="text-3xl font-bold tracking-tight tabular-nums">
            {animatedPromedio.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Pagos por d&iacute;a</p>
        </motion.div>

        {/* Dias con Datos */}
        <motion.div variants={item} className="glass-card rounded-xl p-5 group hover:glass-card-elevated transition-all duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 group-hover:bg-rose-500/15 transition-colors">
              <CalendarDays className="w-4 h-4 text-rose-400" />
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Cobertura
            </p>
          </div>
          <p className="text-3xl font-bold tracking-tight tabular-nums">
            {diasConDatos}<span className="text-lg text-muted-foreground font-normal">/31</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">D&iacute;as del mes</p>
        </motion.div>
      </motion.div>
    </div>
  );
};
