"use client";

import { useEffect, useRef, useState, memo } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const formatNumber = (n: number): string =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

const useAnimatedNumber = (target: number, duration = 1200): number => {
  const [current, setCurrent] = useState(0);
  const ref = useRef<number | null>(null);

  useEffect(() => {
    if (ref.current !== null) cancelAnimationFrame(ref.current);
    const start = performance.now();
    const from = current;
    const step = (now: number): void => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
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

/** Build an SVG path for a sparkline. */
const sparklinePath = (data: number[], width: number, height: number): string => {
  if (data.length < 2) return "";
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });
  return `M ${points.join(" L ")}`;
};

export interface KPICardProps {
  value: number;
  subtitle: string;
  icon: LucideIcon;
  accent?: boolean;
  trend?: number;
  trendDelta?: number;
  sparklineData?: number[];
  tooltip?: string;
  format?: "number" | "currency";
  className?: string;
}

/** Stagger animation variants for parent grid. */
export const kpiGridVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};

const kpiItemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

export const KPICard = memo(({
  value,
  subtitle,
  icon: Icon,
  accent = false,
  trend,
  trendDelta,
  sparklineData,
  tooltip,
  format = "number",
  className,
}: KPICardProps): React.ReactElement => {
  const animated = useAnimatedNumber(value);

  const displayValue =
    format === "currency" ? formatCurrency(animated) : formatNumber(animated);

  return (
    <motion.div
      variants={kpiItemVariants}
      className={cn(
        "rounded-2xl p-5 group transition-all duration-300 min-w-0",
        accent
          ? "bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 shadow-lg shadow-emerald-500/20 text-white"
          : "bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm hover:bg-slate-800/70 hover:border-slate-600/50",
        className
      )}
      title={tooltip}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center justify-center w-9 h-9 rounded-lg",
              accent
                ? "bg-white/20"
                : "bg-emerald-500/10 border border-emerald-500/20"
            )}
          >
            <Icon
              className={cn(
                "w-4 h-4",
                accent ? "text-white" : "text-emerald-400"
              )}
            />
          </div>
          <p
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              accent ? "text-white/70" : "text-muted-foreground"
            )}
          >
            {subtitle}
          </p>
        </div>
        {trend !== undefined && (
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "text-xs font-semibold",
                accent
                  ? "text-white/90"
                  : trend >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
              )}
            >
              {trend >= 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </span>
            {trendDelta !== undefined && (
              <span
                className={cn(
                  "text-xs",
                  accent ? "text-white/60" : "text-slate-500"
                )}
              >
                | {trendDelta >= 0 ? "+" : ""}
                {formatNumber(trendDelta)}
              </span>
            )}
          </div>
        )}
      </div>

      <p
        className={cn(
          "text-3xl font-bold tracking-tight tabular-nums",
          accent ? "text-white" : ""
        )}
      >
        {displayValue}
      </p>

      {/* Sparkline SVG */}
      {sparklineData && sparklineData.length > 1 && (
        <div className="mt-2 h-8 w-full opacity-70" title={tooltip ?? "Tendencia del mes"}>
          <svg
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            className="w-full h-8 block"
          >
            <path
              d={sparklinePath(sparklineData, 100, 24)}
              fill="none"
              stroke={accent ? "rgba(255,255,255,0.6)" : "#34d399"}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </motion.div>
  );
});

KPICard.displayName = "KPICard";
