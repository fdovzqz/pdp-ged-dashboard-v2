"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useAction, useQuery, useConvex } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Database, RefreshCw, Trash2 } from "lucide-react";
import { SyncDialog } from "@/components/dashboard/SyncDialog";
import { formatErrorMessage } from "@/lib/formatErrorMessage";
import {
  PERIOD_START_DATE,
  PERIOD_END_DATE,
  PERIOD_END,
  DATAMAPPING_HISTORY_START,
  generateMonthRange,
  generateDateRange,
  ANALYSIS_MONTH_STRING,
} from "@/lib/constants";

const DATAMAPPING_MONTHS = generateMonthRange(
  DATAMAPPING_HISTORY_START.slice(0, 7),
  PERIOD_END
);
const SYNC_STORAGE_KEY = "reconciliation-sync-in-progress";

export default function CargaFuentesPage(): React.ReactElement {
  const [startDate, setStartDate] = useState(PERIOD_START_DATE);
  const [endDate, setEndDate] = useState(PERIOD_END_DATE);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncCurrentDate, setSyncCurrentDate] = useState<string>("");
  const [syncCurrentIndex, setSyncCurrentIndex] = useState(0);
  const [syncTotalDates, setSyncTotalDates] = useState(0);
  const [syncResults, setSyncResults] = useState<{
    inserted: number;
    deleted: number;
    failedDays?: string[];
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncCancelledRef = useRef(false);

  const [dynamoSinceDate, setDynamoSinceDate] = useState("2026-01-01");
  const [dynamoLoading, setDynamoLoading] = useState(false);
  const [dynamoResult, setDynamoResult] = useState<{
    inserted: number;
    updated: number;
    pageCount: number;
    totalInserted: number;
    totalUpdated: number;
  } | null>(null);
  const [dynamoProgressPage, setDynamoProgressPage] = useState(0);
  const [dynamoError, setDynamoError] = useState<string | null>(null);
  const [dynamoDeleteDialogOpen, setDynamoDeleteDialogOpen] = useState(false);
  const [dynamoClearTriggering, setDynamoClearTriggering] = useState(false);
  const [dynamoHistoryError, setDynamoHistoryError] = useState<string | null>(null);
  const [selectedDynamoReextractMonths, setSelectedDynamoReextractMonths] =
    useState<Set<string>>(new Set([ANALYSIS_MONTH_STRING]));
  const [dynamoReextractRunning, setDynamoReextractRunning] = useState(false);
  const [dynamoReextractResult, setDynamoReextractResult] = useState<
    Record<string, { inserted: number; updated: number }> | null
  >(null);
  const [dynamoReextractError, setDynamoReextractError] = useState<string | null>(null);
  const [dynamoIncrementalRunning, setDynamoIncrementalRunning] = useState(false);
  const [dynamoIncrementalResult, setDynamoIncrementalResult] = useState<{
    inserted: number;
    updated: number;
    processed: number;
    newWatermark: string | null;
    message?: string;
  } | null>(null);
  const [dynamoIncrementalError, setDynamoIncrementalError] = useState<string | null>(null);
  const [incrementalInngestTriggering, setIncrementalInngestTriggering] = useState(false);
  const [loadFromDateInngestTriggering, setLoadFromDateInngestTriggering] = useState(false);
  const [loadFromDateInngestJobId, setLoadFromDateInngestJobId] = useState<
    Id<"pipelineJobs"> | null
  >(null);
  const [fechaTransaccionSinceDate, setFechaTransaccionSinceDate] = useState("2024-01-01");
  const [fechaTransaccionFullInngestTriggering, setFechaTransaccionFullInngestTriggering] =
    useState(false);
  const [fechaTransaccionFromDateInngestTriggering, setFechaTransaccionFromDateInngestTriggering] =
    useState(false);
  const [fechaTransaccionFromDateInngestJobId, setFechaTransaccionFromDateInngestJobId] =
    useState<Id<"pipelineJobs"> | null>(null);
  const [dynamoHistoryTriggering, setDynamoHistoryTriggering] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SYNC_STORAGE_KEY);
      if (stored) {
        localStorage.removeItem(SYNC_STORAGE_KEY);
        setSyncDialogOpen(true);
        setSyncError(
          "La sincronización anterior fue interrumpida (recarga o cierre de pestaña). Puedes iniciar una nueva sincronización."
        );
      }
    } catch {
      // Ignorar errores de localStorage
    }
  }, []);

  const [effectiveStart, effectiveEnd] =
    startDate && endDate && startDate <= endDate
      ? [startDate, endDate]
      : startDate && endDate
        ? [endDate, startDate]
        : [PERIOD_START_DATE, PERIOD_END_DATE];
  const periodDates = generateDateRange(effectiveStart, effectiveEnd);

  const fetchAndIngest = useAction(api.actions.fetchAndIngestForDate);
  const fetchDatamappingAndIngest = useAction(api.actions.fetchDatamappingAndIngest);
  const fetchDatamappingForMonth = useAction(api.actions.fetchDatamappingForMonth);
  const fetchDatamappingIncremental = useAction(api.actions.fetchDatamappingIncremental);
  const convex = useConvex();
  const [datamappingWatermark, setDatamappingWatermark] = useState<{
    lastUpdatedAt: string | null;
  } | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    convex.query(api.queries.getDatamappingWatermark).then((value) => {
      if (!cancelled) setDatamappingWatermark(value);
    });
    return () => {
      cancelled = true;
    };
  }, [convex]);
  const latestDatamappingFullHistoryJob = useQuery(
    api.pipelineJobs.getLatestDatamappingFullHistoryJob
  );
  const latestDatamappingClearJob = useQuery(
    api.pipelineJobs.getLatestDatamappingClearJob
  );
  const latestFechaTransaccionFullJob = useQuery(
    api.pipelineJobs.getLatestFechaTransaccionFullJob
  );

  const handleStartSync = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setSyncProgress(0);
    setSyncCurrentDate("");
    setSyncResults(null);
    setSyncError(null);
    syncCancelledRef.current = false;
    try {
      localStorage.setItem(
        SYNC_STORAGE_KEY,
        JSON.stringify({
          startTime: Date.now(),
          startDate: effectiveStart,
          endDate: effectiveEnd,
        })
      );
    } catch {
      // Ignorar localStorage
    }
    let totalInserted = 0;
    let totalDeleted = 0;
    const failedDays: string[] = [];
    for (let i = 0; i < periodDates.length; i++) {
      if (syncCancelledRef.current) break;
      const dateStr = periodDates[i];
      setSyncCurrentDate(dateStr);
      setSyncCurrentIndex(i + 1);
      setSyncTotalDates(periodDates.length);
      try {
        const res = await fetchAndIngest({ date: dateStr });
        totalInserted += res.inserted ?? 0;
        totalDeleted += res.deleted ?? 0;
      } catch {
        failedDays.push(dateStr);
      }
      setSyncProgress(((i + 1) / periodDates.length) * 100);
    }
    const cancelled = syncCancelledRef.current;
    setSyncResults({
      inserted: totalInserted,
      deleted: totalDeleted,
      ...(failedDays.length > 0 && { failedDays }),
    });
    setSyncError(
      cancelled
        ? "Sincronización detenida por el usuario."
        : failedDays.length > 0
          ? `Días con error (${failedDays.length}): ${failedDays.slice(0, 5).join(", ")}${failedDays.length > 5 ? "..." : ""}. Límite 600s/día.`
          : null
    );
    setSyncing(false);
    try {
      localStorage.removeItem(SYNC_STORAGE_KEY);
    } catch {
      // Ignorar
    }
  }, [fetchAndIngest, periodDates, effectiveStart, effectiveEnd]);

  const handleCancelSync = useCallback((): void => {
    syncCancelledRef.current = true;
  }, []);

  const handleLoadDynamo = useCallback(async (): Promise<void> => {
    setDynamoLoading(true);
    setDynamoResult(null);
    setDynamoError(null);
    setDynamoProgressPage(0);
    let totalInserted = 0;
    let totalUpdated = 0;
    let pageIndex = 0;
    let exclusiveStartKey: string | undefined = undefined;
    try {
      do {
        pageIndex += 1;
        setDynamoProgressPage(pageIndex);
        const res = await fetchDatamappingAndIngest({
          sinceDate: dynamoSinceDate,
          exclusiveStartKey,
        });
        totalInserted += res.inserted;
        totalUpdated += res.updated;
        exclusiveStartKey = res.lastEvaluatedKey;
        setDynamoResult({
          inserted: res.inserted,
          updated: res.updated,
          pageCount: pageIndex,
          totalInserted,
          totalUpdated,
        });
        if (!res.hasMore) break;
      } while (exclusiveStartKey);
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al cargar DynamoDB"
      );
      setDynamoResult({
        inserted: 0,
        updated: 0,
        pageCount: pageIndex,
        totalInserted,
        totalUpdated,
      });
    } finally {
      setDynamoLoading(false);
      setDynamoProgressPage(0);
    }
  }, [fetchDatamappingAndIngest, dynamoSinceDate]);

  const handleDynamoFullHistory = useCallback(async (): Promise<void> => {
    setDynamoHistoryError(null);
    setDynamoHistoryTriggering(true);
    try {
      const res = await fetch("/api/datamapping/full-history", { method: "POST" });
      const text = await res.text();
      let data: { ok?: boolean; error?: string } = {};
      try {
        data = JSON.parse(text) as { ok?: boolean; error?: string };
      } catch {
        if (text.includes("524") || text.toLowerCase().includes("timeout")) {
          setDynamoHistoryError(
            "Timeout: el servidor tardó demasiado en responder (524). Intenta de nuevo."
          );
        } else {
          setDynamoHistoryError("Error del servidor. Intenta de nuevo.");
        }
        return;
      }
      if (!res.ok || !data.ok) {
        setDynamoHistoryError(
          formatErrorMessage(data.error) || "Error al iniciar job"
        );
      }
    } catch (err) {
      setDynamoHistoryError(
        formatErrorMessage(err instanceof Error ? err.message : String(err)) ||
          "Error al iniciar job"
      );
    } finally {
      setDynamoHistoryTriggering(false);
    }
  }, []);

  const handleDynamoReextract = useCallback(async (): Promise<void> => {
    if (selectedDynamoReextractMonths.size === 0) return;
    setDynamoReextractRunning(true);
    setDynamoReextractError(null);
    setDynamoReextractResult(null);
    let results: Record<string, { inserted: number; updated: number }> = {};
    try {
      const promiseResults = await Promise.all(
        Array.from(selectedDynamoReextractMonths).map(async (ym) => {
          const [y, m] = ym.split("-").map(Number);
          const res = await fetchDatamappingForMonth({ year: y, month: m });
          return { ym, inserted: res.inserted, updated: res.updated };
        })
      );
      results = Object.fromEntries(
        promiseResults.map((r) => [
          r.ym,
          { inserted: r.inserted, updated: r.updated },
        ])
      );
      setDynamoReextractResult(results);
    } catch (err) {
      setDynamoReextractError(
        err instanceof Error ? err.message : "Error al re-extraer"
      );
      if (Object.keys(results).length > 0) setDynamoReextractResult(results);
    } finally {
      setDynamoReextractRunning(false);
    }
  }, [fetchDatamappingForMonth, selectedDynamoReextractMonths]);

  const handleDynamoIncremental = useCallback(async (): Promise<void> => {
    setDynamoIncrementalRunning(true);
    setDynamoIncrementalError(null);
    setDynamoIncrementalResult(null);
    try {
      const res = await fetchDatamappingIncremental({});
      setDynamoIncrementalResult(res);
    } catch (err) {
      setDynamoIncrementalError(
        err instanceof Error ? err.message : "Error en extracción incremental"
      );
    } finally {
      setDynamoIncrementalRunning(false);
    }
  }, [fetchDatamappingIncremental]);

  const toggleDynamoReextractMonth = useCallback((month: string): void => {
    setSelectedDynamoReextractMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }, []);

  const handleClearDatamapping = useCallback(async (): Promise<void> => {
    setDynamoClearTriggering(true);
    setDynamoError(null);
    setDynamoDeleteDialogOpen(false);
    try {
      const res = await fetch("/api/datamapping/clear", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar borrado");
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar borrado"
      );
    } finally {
      setDynamoClearTriggering(false);
    }
  }, []);

  const handleIncrementalInngest = useCallback(async (): Promise<void> => {
    setIncrementalInngestTriggering(true);
    try {
      const res = await fetch("/api/datamapping/incremental", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setDynamoIncrementalError(data.error ?? "Error al disparar Inngest");
      }
    } catch (err) {
      setDynamoIncrementalError(
        err instanceof Error ? err.message : "Error al disparar Inngest"
      );
    } finally {
      setIncrementalInngestTriggering(false);
    }
  }, []);

  const handleLoadFromDateInngest = useCallback(async (): Promise<void> => {
    setLoadFromDateInngestJobId(null);
    setLoadFromDateInngestTriggering(true);
    try {
      const res = await fetch("/api/datamapping/load-from-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDate: dynamoSinceDate }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: Id<"pipelineJobs">;
      };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar carga desde fecha");
      } else if (data.jobId) {
        setLoadFromDateInngestJobId(data.jobId);
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar carga desde fecha"
      );
    } finally {
      setLoadFromDateInngestTriggering(false);
    }
  }, [dynamoSinceDate]);

  const handleFechaTransaccionFullInngest = useCallback(async (): Promise<void> => {
    setFechaTransaccionFullInngestTriggering(true);
    try {
      const res = await fetch("/api/datamapping/fecha-transaccion-full", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: Id<"pipelineJobs">;
      };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar backfill fechaTransaccion");
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar backfill fechaTransaccion"
      );
    } finally {
      setFechaTransaccionFullInngestTriggering(false);
    }
  }, []);

  const handleFechaTransaccionFromDateInngest = useCallback(async (): Promise<void> => {
    setFechaTransaccionFromDateInngestJobId(null);
    setFechaTransaccionFromDateInngestTriggering(true);
    try {
      const res = await fetch("/api/datamapping/fecha-transaccion-from-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDate: fechaTransaccionSinceDate }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: Id<"pipelineJobs">;
      };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar backfill fechaTransaccion");
      } else if (data.jobId) {
        setFechaTransaccionFromDateInngestJobId(data.jobId);
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar backfill fechaTransaccion"
      );
    } finally {
      setFechaTransaccionFromDateInngestTriggering(false);
    }
  }, [fechaTransaccionSinceDate]);

  const busy =
    latestDatamappingClearJob?.status === "pending" ||
    latestDatamappingClearJob?.status === "running" ||
    latestDatamappingFullHistoryJob?.status === "pending" ||
    latestDatamappingFullHistoryJob?.status === "running" ||
    latestFechaTransaccionFullJob?.status === "pending" ||
    latestFechaTransaccionFullJob?.status === "running" ||
    dynamoReextractRunning ||
    dynamoIncrementalRunning ||
    dynamoLoading ||
    syncing;

  return (
    <div className="p-6 md:p-8" suppressHydrationWarning>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-space-grotesk gradient-text-emerald">
            Carga de fuentes
          </h1>
          <p className="text-muted-foreground mt-1">
            Sincroniza CloudWatch y Datamapping (DynamoDB). El estado de los jobs
            se puede ver en{" "}
            <Link
              href="/configuracion/status"
              className="text-emerald-400 hover:text-emerald-300 font-medium"
            >
              Status de actualizaciones
            </Link>
            .
          </p>
        </div>

        {/* Sincronizar CloudWatch */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCw className="size-5" />
            Sincronizar CloudWatch
          </h2>
          <p className="text-sm text-muted-foreground">
            Extrae datos de CloudWatch Logs para cada día del período.
          </p>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Período desde</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={PERIOD_START_DATE}
                max={PERIOD_END_DATE}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">hasta</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={PERIOD_START_DATE}
                max={PERIOD_END_DATE}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={() => {
                setSyncResults(null);
                setSyncError(null);
                setSyncDialogOpen(true);
              }}
              disabled={syncing}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              <RefreshCw className="size-3.5" />
              Sincronizar Período
            </Button>
          </div>
        </div>

        {/* Datamapping (DynamoDB) */}
        <div className="glass-card rounded-xl p-6 space-y-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="size-5" />
            Datamapping (DynamoDB)
            <Link
              href="/reconcile/january-2026"
              className="text-sm font-normal text-emerald-400 hover:text-emerald-300 ml-auto"
            >
              Reconciliar →
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground">
            Datamapping por updatedAt (todos los status). Upsert por referencia (sin
            duplicados). ~900k registros total, +400k pagados.
          </p>

          {/* 1. Histórico completo */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              1. Histórico completo (desde {DATAMAPPING_HISTORY_START})
            </h3>
            <p className="text-xs text-muted-foreground">
              Dispara job en Inngest (1 ejecución por mes, en paralelo). Portal
              Durango entró en operación ene 2024. Avance persistido en Convex.
            </p>
            <Button
              size="sm"
              onClick={handleDynamoFullHistory}
              disabled={dynamoHistoryTriggering || busy}
              className="gap-2 bg-amber-600 hover:bg-amber-700"
            >
              {dynamoHistoryTriggering ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Iniciando...
                </>
              ) : latestDatamappingFullHistoryJob?.status === "running" ||
                latestDatamappingFullHistoryJob?.status === "pending" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  En curso...
                </>
              ) : (
                <>
                  <Database className="size-3.5" />
                  Extraer toda la historia
                </>
              )}
            </Button>
            {latestDatamappingFullHistoryJob?.status === "running" && (
              <div className="space-y-2">
                <Progress
                  value={
                    latestDatamappingFullHistoryJob.progress?.total != null &&
                    latestDatamappingFullHistoryJob.progress?.total > 0
                      ? ((latestDatamappingFullHistoryJob.progress?.current ?? 0) /
                          latestDatamappingFullHistoryJob.progress!.total!) *
                        100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {latestDatamappingFullHistoryJob.progress?.message ??
                    `Mes ${latestDatamappingFullHistoryJob.progress?.current ?? 0} de ${latestDatamappingFullHistoryJob.progress?.total ?? "?"}`}
                </p>
              </div>
            )}
            {latestDatamappingFullHistoryJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Histórico completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingFullHistoryJob.result != null &&
                  typeof latestDatamappingFullHistoryJob.result === "object" &&
                  "totalInserted" in latestDatamappingFullHistoryJob.result &&
                  "totalUpdated" in latestDatamappingFullHistoryJob.result
                    ? `${(latestDatamappingFullHistoryJob.result as { totalInserted: number }).totalInserted} insertados, ${(latestDatamappingFullHistoryJob.result as { totalUpdated: number }).totalUpdated} actualizados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestDatamappingFullHistoryJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestDatamappingFullHistoryJob.errorMessage)}
                </p>
              </div>
            )}
            {dynamoHistoryError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error al iniciar</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(dynamoHistoryError)}
                </p>
              </div>
            )}
          </div>

          {/* 2. Re-extraer período */}
          <div className="space-y-2 border-t border-slate-700/50 pt-4">
            <h3 className="text-sm font-medium">2. Re-extraer período</h3>
            <p className="text-xs text-muted-foreground">
              Re-extrae meses seleccionados (upsert: actualiza registros modificados).
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedDynamoReextractMonths(new Set(DATAMAPPING_MONTHS))
                }
                disabled={dynamoReextractRunning}
                className="bg-white/3 border-border/50"
              >
                Todos
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedDynamoReextractMonths(new Set([ANALYSIS_MONTH_STRING]))
                }
                disabled={dynamoReextractRunning}
                className="bg-white/3 border-border/50"
              >
                Solo ene 2026
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {DATAMAPPING_MONTHS.map((m) => (
                <label
                  key={m}
                  className="flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded border border-slate-700/50 hover:bg-slate-800/30 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedDynamoReextractMonths.has(m)}
                    onChange={() => toggleDynamoReextractMonth(m)}
                    disabled={dynamoReextractRunning}
                    className="rounded"
                  />
                  <span>{m}</span>
                </label>
              ))}
            </div>
            <Button
              size="sm"
              onClick={handleDynamoReextract}
              disabled={
                dynamoReextractRunning ||
                selectedDynamoReextractMonths.size === 0 ||
                busy
              }
              className="gap-2 bg-amber-600/80 hover:bg-amber-600"
            >
              {dynamoReextractRunning ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Re-extraendo...
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" />
                  Re-extraer meses seleccionados
                </>
              )}
            </Button>
            {dynamoReextractResult && !dynamoReextractRunning && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Re-extracción completada</p>
                <p className="mt-1 text-xs">
                  {Object.entries(dynamoReextractResult).reduce(
                    (acc, [, v]) => acc + v.inserted + v.updated,
                    0
                  )}{" "}
                  registros procesados
                </p>
              </div>
            )}
            {dynamoReextractError && !dynamoReextractRunning && (
              <div className="text-sm text-destructive">{dynamoReextractError}</div>
            )}
          </div>

          {/* 3. Incremental */}
          <div className="space-y-2 border-t border-slate-700/50 pt-4">
            <h3 className="text-sm font-medium">3. Incremental (últimos cambios)</h3>
            <p className="text-xs text-muted-foreground">
              Desde última marca. Cron Inngest cada 5 min; o disparar manual aquí.
            </p>
            {datamappingWatermark?.lastUpdatedAt ? (
              <p className="text-xs text-muted-foreground">
                Marca actual: {datamappingWatermark.lastUpdatedAt}
              </p>
            ) : (
              <p className="text-xs text-amber-400/90">
                No hay marca de agua. Ejecutar primero &quot;1. Histórico completo&quot; o &quot;Cargar desde fecha&quot;.
              </p>
            )}
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                size="sm"
                onClick={handleDynamoIncremental}
                disabled={dynamoIncrementalRunning || busy}
                className="gap-2 bg-slate-600 hover:bg-slate-500"
              >
                {dynamoIncrementalRunning ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Extrayendo...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Extraer cambios recientes
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleIncrementalInngest}
                disabled={incrementalInngestTriggering || busy}
                className="gap-2 bg-white/3 border-border/50"
              >
                {incrementalInngestTriggering ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  "Disparar (Inngest)"
                )}
              </Button>
            </div>
            {dynamoIncrementalResult && !dynamoIncrementalRunning && (
              <div
                className={`rounded-lg p-3 text-sm ${
                  dynamoIncrementalResult.message
                    ? "bg-amber-500/10 border border-amber-500/30 text-amber-400"
                    : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                }`}
              >
                <p className="font-medium">
                  {dynamoIncrementalResult.message
                    ? "Incremental"
                    : "Incremental completado"}
                </p>
                <p className="mt-1 text-xs">
                  {dynamoIncrementalResult.message ??
                    `${dynamoIncrementalResult.processed} procesados (${dynamoIncrementalResult.inserted} ins, ${dynamoIncrementalResult.updated} act)${
                      dynamoIncrementalResult.newWatermark
                        ? ` · Nueva marca: ${dynamoIncrementalResult.newWatermark}`
                        : ""
                    }`}
                </p>
              </div>
            )}
            {dynamoIncrementalError && !dynamoIncrementalRunning && (
              <div className="text-sm text-destructive">{dynamoIncrementalError}</div>
            )}
          </div>

          {/* 4. Carga manual + Borrar */}
          <div className="flex flex-wrap gap-4 items-end border-t border-slate-700/50 pt-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                Carga manual (updatedAt posterior a)
              </label>
              <input
                type="date"
                value={dynamoSinceDate}
                onChange={(e) => setDynamoSinceDate(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={handleLoadDynamo}
              disabled={dynamoLoading || busy}
              variant="outline"
              className="gap-2 bg-white/3 border-border/50"
            >
              {dynamoLoading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {dynamoProgressPage > 0 ? `Pág. ${dynamoProgressPage}` : "..."}
                </>
              ) : (
                "Cargar desde fecha"
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleLoadFromDateInngest}
              disabled={loadFromDateInngestTriggering || dynamoLoading || busy}
              className="gap-2 bg-white/3 border-border/50"
            >
              {loadFromDateInngestTriggering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Cargar desde fecha (Inngest)"
              )}
            </Button>
            {(loadFromDateInngestJobId || fechaTransaccionFromDateInngestJobId) && (
              <span className="text-xs text-muted-foreground">
                Job creado. Ver en{" "}
                <Link
                  href="/configuracion/status"
                  className="text-emerald-400 hover:text-emerald-300"
                >
                  Status de actualizaciones
                </Link>
                .
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDynamoDeleteDialogOpen(true)}
              disabled={
                dynamoLoading ||
                dynamoClearTriggering ||
                latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running" ||
                latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running" ||
                dynamoReextractRunning ||
                dynamoIncrementalRunning ||
                syncing
              }
              className="gap-2 bg-white/3 border-border/50 text-red-400 hover:text-red-300"
            >
              {dynamoClearTriggering ||
              latestDatamappingClearJob?.status === "pending" ||
              latestDatamappingClearJob?.status === "running" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Borrar datamapping
            </Button>
            {latestDatamappingClearJob?.status === "running" && (
              <div className="space-y-2 w-full max-w-sm">
                <Progress
                  value={
                    latestDatamappingClearJob.progress?.total != null &&
                    latestDatamappingClearJob.progress?.total > 0
                      ? ((latestDatamappingClearJob.progress?.current ?? 0) /
                          latestDatamappingClearJob.progress!.total!) *
                        100
                      : 0
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {latestDatamappingClearJob.progress?.message ??
                    `Lote ${latestDatamappingClearJob.progress?.current ?? 0} de ${latestDatamappingClearJob.progress?.total ?? "?"}`}
                </p>
              </div>
            )}
            {latestDatamappingClearJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Borrado completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingClearJob.result != null &&
                  typeof latestDatamappingClearJob.result === "object" &&
                  "totalDeleted" in latestDatamappingClearJob.result
                    ? `${(latestDatamappingClearJob.result as { totalDeleted: number }).totalDeleted} registros eliminados`
                    : "Marca de agua borrada"}
                </p>
              </div>
            )}
            {latestDatamappingClearJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error en borrado</p>
                <p className="mt-1 text-xs">
                  {formatErrorMessage(latestDatamappingClearJob.errorMessage)}
                </p>
              </div>
            )}
          </div>

          {/* 5. Backfill fechaTransaccion */}
          <div className="flex flex-wrap gap-4 items-end border-t border-slate-700/50 pt-4">
            <h3 className="text-sm font-medium w-full">
              5. Backfill fechaTransaccion (DataMapping)
            </h3>
            <p className="text-xs text-muted-foreground w-full -mt-2">
              Llena fechaTransaccion desde paymentRecords (por referencia); fallback a
              updatedAt si no existe en CloudWatch.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                Desde fecha (updatedAt posterior a)
              </label>
              <input
                type="date"
                value={fechaTransaccionSinceDate}
                onChange={(e) => setFechaTransaccionSinceDate(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleFechaTransaccionFullInngest}
              disabled={fechaTransaccionFullInngestTriggering || busy}
              className="gap-2 bg-white/3 border-border/50"
            >
              {fechaTransaccionFullInngestTriggering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Llenar fechaTransaccion (Inngest)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleFechaTransaccionFromDateInngest}
              disabled={fechaTransaccionFromDateInngestTriggering || busy}
              className="gap-2 bg-white/3 border-border/50"
            >
              {fechaTransaccionFromDateInngestTriggering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Llenar desde fecha (Inngest)
            </Button>
            {latestFechaTransaccionFullJob?.status === "running" && (
              <div className="space-y-2 w-full max-w-sm">
                <Progress
                  value={
                    latestFechaTransaccionFullJob.progress?.total != null &&
                    latestFechaTransaccionFullJob.progress?.total > 0
                      ? ((latestFechaTransaccionFullJob.progress?.current ?? 0) /
                          latestFechaTransaccionFullJob.progress!.total!) *
                        100
                      : 0
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {latestFechaTransaccionFullJob.progress?.message ??
                    `Mes ${latestFechaTransaccionFullJob.progress?.current ?? 0} de ${latestFechaTransaccionFullJob.progress?.total ?? "?"}`}
                </p>
              </div>
            )}
            {latestFechaTransaccionFullJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Backfill fechaTransaccion completado</p>
                <p className="mt-1 text-xs">
                  {latestFechaTransaccionFullJob.result != null &&
                  typeof latestFechaTransaccionFullJob.result === "object" &&
                  "totalProcessed" in latestFechaTransaccionFullJob.result &&
                  "totalUpdated" in latestFechaTransaccionFullJob.result
                    ? `${(latestFechaTransaccionFullJob.result as { totalProcessed: number }).totalProcessed} procesados, ${(latestFechaTransaccionFullJob.result as { totalUpdated: number }).totalUpdated} actualizados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestFechaTransaccionFullJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error en backfill fechaTransaccion</p>
                <p className="mt-1 text-xs">
                  {formatErrorMessage(latestFechaTransaccionFullJob.errorMessage)}
                </p>
              </div>
            )}
          </div>
          {dynamoResult && !dynamoLoading && (
            <div className="text-sm text-emerald-400">
              Carga manual: {dynamoResult.totalInserted} ins, {dynamoResult.totalUpdated} act
            </div>
          )}
          {dynamoError && !dynamoLoading && (
            <div className="text-sm text-destructive">{dynamoError}</div>
          )}
        </div>
      </div>

      <SyncDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        onStartSync={handleStartSync}
        onCancelSync={handleCancelSync}
        syncing={syncing}
        progress={syncProgress}
        currentDate={syncCurrentDate}
        currentIndex={syncCurrentIndex}
        totalDates={syncTotalDates || periodDates.length}
        results={syncResults}
        error={syncError}
        startDate={startDate}
        endDate={endDate}
      />

      <Dialog
        open={dynamoDeleteDialogOpen}
        onOpenChange={setDynamoDeleteDialogOpen}
      >
        <DialogContent className="glass-card-elevated border-border/50">
          <DialogHeader>
            <DialogTitle>Borrar datos DynamoDB</DialogTitle>
            <DialogDescription>
              Se disparará un job (Inngest) que borrará todos los registros de
              datamappingRecords y la marca de agua. Podrás ver el avance en
              Status de actualizaciones y volver a cargar desde DynamoDB después.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={handleClearDatamapping}
              disabled={
                dynamoClearTriggering ||
                latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running"
              }
              size="sm"
            >
              {dynamoClearTriggering ||
              latestDatamappingClearJob?.status === "pending" ||
              latestDatamappingClearJob?.status === "running"
                ? "Iniciando..."
                : "Confirmar borrado"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDynamoDeleteDialogOpen(false)}
              disabled={
                dynamoClearTriggering ||
                latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running"
              }
              size="sm"
              className="bg-white/3 border-border/50"
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
