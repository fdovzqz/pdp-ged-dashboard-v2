"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export const DashboardSkeleton = (): React.ReactElement => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      {/* Header skeleton */}
      <div className="flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-slate-800/50 animate-pulse" />
        <div>
          <div className="h-8 w-72 bg-slate-700/50 rounded-lg animate-pulse" />
          <div className="h-4 w-48 bg-slate-800/50 rounded mt-2 animate-pulse" />
          <div className="flex gap-2 mt-3">
            <div className="h-6 w-24 bg-slate-800/50 rounded-full animate-pulse" />
            <div className="h-6 w-20 bg-slate-800/50 rounded-full animate-pulse" />
          </div>
        </div>
      </div>

      {/* KPI skeleton — 4 columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="rounded-2xl p-5 bg-slate-800/40 border border-slate-700/30 animate-pulse"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-slate-700/50" />
              <div className="h-3 w-24 bg-slate-700/50 rounded" />
            </div>
            <div className="h-8 w-28 bg-slate-600/50 rounded" />
            <div className="h-6 w-full bg-slate-800/30 rounded mt-3" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="rounded-2xl bg-slate-800/40 border border-slate-700/30 p-6">
        <div className="flex items-center justify-center min-h-[320px]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <p className="text-slate-400 text-sm">Cargando dashboard...</p>
          </div>
        </div>
      </div>

      {/* Two column skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-slate-800/40 border border-slate-700/30 p-6 min-h-[200px] animate-pulse">
          <div className="h-5 w-32 bg-slate-700/50 rounded mb-4" />
          <div className="space-y-2">
            <div className="h-3 w-full bg-slate-800/30 rounded" />
            <div className="h-3 w-3/4 bg-slate-800/30 rounded" />
            <div className="h-3 w-5/6 bg-slate-800/30 rounded" />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-800/40 border border-slate-700/30 p-6 min-h-[200px] animate-pulse">
          <div className="h-5 w-40 bg-slate-700/50 rounded mb-4" />
          <div className="space-y-2">
            <div className="h-3 w-full bg-slate-800/30 rounded" />
            <div className="h-3 w-2/3 bg-slate-800/30 rounded" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};
