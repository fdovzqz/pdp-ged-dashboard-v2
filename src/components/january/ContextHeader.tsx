"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Building2, Download, Maximize2, Loader2 } from "lucide-react";
import { ANALYSIS_MONTH_LABEL } from "@/lib/constants";

export interface ContextHeaderProps {
  title: string;
  description?: string;
  lastAvailableDay?: number;
  onExportPdf?: () => Promise<void>;
}

export const ContextHeader = ({
  title,
  description,
  lastAvailableDay,
  onExportPdf,
}: ContextHeaderProps): React.ReactElement => {
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!onExportPdf || exporting) return;
    setExporting(true);
    try {
      await onExportPdf();
    } finally {
      setExporting(false);
    }
  }, [onExportPdf, exporting]);

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-wrap items-start justify-between gap-4 mb-2"
    >
      <div className="flex items-center gap-5">
        {/* Logo with glow effect */}
        <div className="relative">
          <div className="absolute inset-0 bg-emerald-500/30 blur-xl rounded-full" />
          <div className="relative bg-gradient-to-br from-emerald-400 to-teal-600 p-4 rounded-2xl shadow-lg shadow-emerald-500/20">
            <Building2 size={32} className="text-white" />
          </div>
        </div>

        <div>
          <h1 className="text-3xl font-bold tracking-tight font-display gradient-text-emerald">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 text-muted-foreground text-sm max-w-2xl">
              {description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            {/* Badge LIVE with ping */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/25 text-emerald-400 text-xs font-bold rounded-full border border-emerald-500/40">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              DATOS ENERO
            </span>

            {/* Period badge */}
            <span className="inline-flex items-center px-3 py-1 bg-slate-800/60 text-slate-300 text-xs font-medium rounded-full border border-slate-700/50">
              {ANALYSIS_MONTH_LABEL}
            </span>

            {/* Corte badge */}
            {lastAvailableDay !== undefined && lastAvailableDay > 0 && (
              <span className="inline-flex items-center px-3 py-1 bg-slate-800/60 text-slate-400 text-xs font-medium rounded-full border border-slate-700/50">
                Corte: {lastAvailableDay} de Enero, 2026
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {onExportPdf && (
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 text-sm font-medium rounded-xl border border-slate-700/50 transition-all disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Exportar PDF
          </button>
        )}
        <button
          type="button"
          onClick={handleFullscreen}
          className="inline-flex items-center justify-center w-9 h-9 bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 rounded-xl border border-slate-700/50 transition-all"
          title="Pantalla completa"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </motion.header>
  );
};
