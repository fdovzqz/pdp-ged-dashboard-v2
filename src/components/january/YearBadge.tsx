"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const YEAR_COLORS: Record<string, string> = {
  "2024": "bg-rose-500/20 text-rose-400 border-rose-500/40 hover:bg-rose-500/30",
  "2025": "bg-violet-500/20 text-violet-400 border-violet-500/40 hover:bg-violet-500/30",
  "2026": "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30",
};

export interface YearBadgeProps {
  year: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}

export const YearBadge = ({
  year,
  active,
  onClick,
  className,
}: YearBadgeProps): React.ReactElement => {
  const colorClass = YEAR_COLORS[year] ?? "bg-slate-500/20 text-slate-400";

  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
        colorClass,
        active
          ? "ring-2 ring-offset-2 ring-offset-slate-900 ring-emerald-400/60"
          : "opacity-50",
        className
      )}
    >
      {year}
    </motion.button>
  );
};
