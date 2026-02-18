"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Database, RefreshCw } from "lucide-react";
import {
  PERIOD_START,
  PERIOD_END,
  ANALYSIS_MONTH_STRING,
  generateMonthRange,
} from "@/lib/constants";

const ALL_MONTHS = generateMonthRange(PERIOD_START, PERIOD_END);

export default function EnriquecimientoAgregacionesPage(): React.ReactElement {
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(
    new Set([ANALYSIS_MONTH_STRING])
  );
  const [cwAggregatesRunning, setCwAggregatesRunning] = useState(false);
  const [cwAggregatesProgress, setCwAggregatesProgress] = useState(0);
  const [cwAggregatesResult, setCwAggregatesResult] = useState<
    Record<string, unknown> | null
  >(null);
  const [cwAggregatesError, setCwAggregatesError] = useState<string | null>(null);

  const [selectedDatamappingMonths, setSelectedDatamappingMonths] = useState<
    Set<string>
  >(new Set([ANALYSIS_MONTH_STRING]));
  const [dmAggregatesRunning, setDmAggregatesRunning] = useState(false);
  const [dmAggregatesResult, setDmAggregatesResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [dmAggregatesError, setDmAggregatesError] = useState<string | null>(null);

  const buildAggregates = useAction(api.januaryETL.buildJanuaryAggregates);
  const buildDatamappingAggregates = useAction(
    api.datamappingETL.buildDatamappingAggregates
  );

  const toggleMonth = useCallback((month: string): void => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }, []);

  const toggleDatamappingMonth = useCallback((month: string): void => {
    setSelectedDatamappingMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }, []);

  const handleBuildCwAggregates = useCallback(async (): Promise<void> => {
    setCwAggregatesRunning(true);
    setCwAggregatesError(null);
    setCwAggregatesResult(null);
    setCwAggregatesProgress(10);
    try {
      const months = Array.from(selectedMonths).sort();
      setCwAggregatesProgress(30);
      const res = await buildAggregates({ months });
      setCwAggregatesProgress(100);
      setCwAggregatesResult(res as Record<string, unknown>);
    } catch (e) {
      setCwAggregatesError(
        e instanceof Error ? e.message : "Error al generar agregados"
      );
    } finally {
      setCwAggregatesRunning(false);
    }
  }, [buildAggregates, selectedMonths]);

  const handleBuildDatamapping = useCallback(async (): Promise<void> => {
    setDmAggregatesRunning(true);
    setDmAggregatesResult(null);
    setDmAggregatesError(null);
    try {
      const months = Array.from(selectedDatamappingMonths).sort();
      const res = await buildDatamappingAggregates({ months });
      setDmAggregatesResult(res as Record<string, unknown>);
    } catch (err) {
      setDmAggregatesError(
        err instanceof Error ? err.message : "Error al generar agregaciones"
      );
    } finally {
      setDmAggregatesRunning(false);
    }
  }, [buildDatamappingAggregates, selectedDatamappingMonths]);

  return (
    <div className="p-6 md:p-8" suppressHydrationWarning>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-space-grotesk gradient-text-emerald">
            Enriquecimiento y agregaciones
          </h1>
          <p className="text-muted-foreground mt-1">
            Genera tablas agregadas desde paymentRecords (CloudWatch) y
            datamappingRecords (DataMapping) para Análisis Mensual y Anual.
          </p>
        </div>

        {/* Enriquecimiento (en la carga) */}
        <div className="glass-card rounded-xl p-6 space-y-2">
          <h2 className="text-lg font-semibold">Enriquecimiento (en la carga)</h2>
          <p className="text-sm text-muted-foreground">
            La carga desde DynamoDB ya incluye enriquecimiento en un solo paso: se
            extraen RFC, placa, evoId, codiId, expirationDate, folioNumber, loteId,
            procedureCategory, tramiteId y userId del rawJson y se guardan en cada
            registro. No hace falta ejecutar enriquecimiento ni backfill por
            separado. Búsqueda por RFC en{" "}
            <Link
              href="/reconciliacion/consultas-referencia-rfc-placa"
              className="text-emerald-400 hover:text-emerald-300"
            >
              RFC Referencias
            </Link>
            .
          </p>
        </div>

        {/* Agregados DataMapping */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="size-5" />
            Agregados DataMapping
          </h2>
          <p className="text-sm text-muted-foreground">
            Genera tablas agregadas desde datamappingRecords para Análisis
            Mensual/Anual con fuente DataMapping.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedDatamappingMonths(new Set(ALL_MONTHS))}
              disabled={dmAggregatesRunning}
              className="bg-white/3 border-border/50"
            >
              Seleccionar todos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedDatamappingMonths(new Set())}
              disabled={dmAggregatesRunning}
              className="bg-white/3 border-border/50"
            >
              Deseleccionar todos
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {ALL_MONTHS.map((m) => (
              <label
                key={m}
                className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border border-slate-700/50 hover:bg-slate-800/30 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedDatamappingMonths.has(m)}
                  onChange={() => toggleDatamappingMonth(m)}
                  disabled={dmAggregatesRunning}
                  className="rounded"
                  suppressHydrationWarning
                />
                <span>{m}</span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            onClick={handleBuildDatamapping}
            disabled={
              dmAggregatesRunning || selectedDatamappingMonths.size === 0
            }
            className="gap-2 bg-amber-600 hover:bg-amber-700"
          >
            {dmAggregatesRunning ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Database className="size-3.5" />
                Generar tablas agregadas (DataMapping)
              </>
            )}
          </Button>
          {dmAggregatesResult && !dmAggregatesRunning && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
              <p className="font-medium">Agregaciones completadas</p>
              <pre className="text-xs mt-1 overflow-auto">
                {JSON.stringify(dmAggregatesResult, null, 2)}
              </pre>
            </div>
          )}
          {dmAggregatesError && !dmAggregatesRunning && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              {dmAggregatesError}
            </div>
          )}
        </div>

        {/* Agregados CloudWatch */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCw className="size-5" />
            Agregados CloudWatch
          </h2>
          <p className="text-sm text-muted-foreground">
            Genera tablas agregadas desde paymentRecords para Análisis Mensual y
            Anual.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedMonths(new Set(ALL_MONTHS))}
              disabled={cwAggregatesRunning}
              className="bg-white/3 border-border/50"
            >
              Seleccionar todos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedMonths(new Set())}
              disabled={cwAggregatesRunning}
              className="bg-white/3 border-border/50"
            >
              Deseleccionar todos
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {ALL_MONTHS.map((m) => (
              <label
                key={m}
                className="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded-lg border border-slate-700/50 hover:bg-slate-800/30 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedMonths.has(m)}
                  onChange={() => toggleMonth(m)}
                  disabled={cwAggregatesRunning}
                  className="rounded"
                  suppressHydrationWarning
                />
                <span>{m}</span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            onClick={handleBuildCwAggregates}
            disabled={cwAggregatesRunning || selectedMonths.size === 0}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700"
          >
            {cwAggregatesRunning ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <RefreshCw className="size-3.5" />
                Generar tablas agregadas
              </>
            )}
          </Button>
          {cwAggregatesRunning && (
            <Progress value={cwAggregatesProgress} className="h-2" />
          )}
          {cwAggregatesResult && !cwAggregatesRunning && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
              <p className="font-medium">Agregados completados</p>
              <pre className="text-xs mt-1 overflow-auto">
                {JSON.stringify(cwAggregatesResult, null, 2)}
              </pre>
            </div>
          )}
          {cwAggregatesError && !cwAggregatesRunning && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
              {cwAggregatesError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
