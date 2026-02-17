"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useAction, useQuery, useConvex } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Database, RefreshCw, Trash2, ListTodo } from "lucide-react";
import { SyncDialog } from "@/components/dashboard/SyncDialog";
import {
  PERIOD_START,
  PERIOD_END,
  PERIOD_START_DATE,
  PERIOD_END_DATE,
  DATAMAPPING_HISTORY_START,
  generateMonthRange,
  generateDateRange,
  ANALYSIS_MONTH_STRING,
} from "@/lib/constants";

const ALL_MONTHS = generateMonthRange(PERIOD_START, PERIOD_END);
/** Meses de datamapping: desde portal Durango (2024-01) hasta período actual. */
const DATAMAPPING_MONTHS = generateMonthRange(
  DATAMAPPING_HISTORY_START.slice(0, 7),
  PERIOD_END
);
const SYNC_STORAGE_KEY = "reconciliation-sync-in-progress";

/** Sanitiza mensajes de error: evita mostrar HTML crudo (p. ej. página 524 de Cloudflare). */
function formatErrorMessage(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "Error desconocido";
  const trimmed = raw.trim();
  if (!trimmed) return "Error desconocido";

  // Detectar HTML crudo (respuestas HTTP de error como 524)
  if (
    trimmed.startsWith("<") ||
    trimmed.includes("<!DOCTYPE") ||
    trimmed.includes("<html")
  ) {
    if (
      trimmed.includes("524") ||
      trimmed.toLowerCase().includes("timeout") ||
      trimmed.includes("A timeout occurred")
    ) {
      return "Timeout: el servidor tardó demasiado en responder (524). Intenta de nuevo.";
    }
    if (
      trimmed.includes("502") ||
      trimmed.includes("503") ||
      trimmed.includes("504")
    ) {
      return "Error del servidor (5xx). Intenta de nuevo más tarde.";
    }
    return "Error del servidor. Intenta de nuevo.";
  }

  // Limitar longitud para evitar mensajes enormes
  const maxLen = 500;
  if (trimmed.length > maxLen) {
    return `${trimmed.slice(0, maxLen)}...`;
  }
  return trimmed;
}

function StatusBadge({
  status,
}: {
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
}): React.ReactElement {
  const styles: Record<string, string> = {
    pending: "text-muted-foreground",
    running: "text-amber-400",
    completed: "text-emerald-400",
    failed: "text-destructive",
    cancelled: "text-muted-foreground",
  };
  const labels: Record<string, string> = {
    pending: "Pendiente",
    running: "En curso",
    completed: "Completado",
    failed: "Error",
    cancelled: "Cancelado",
  };
  return <span className={styles[status] ?? ""}>{labels[status] ?? status}</span>;
}

export default function JobsPage(): React.ReactElement {
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

  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(
    new Set([ANALYSIS_MONTH_STRING])
  );
  const [cwAggregatesRunning, setCwAggregatesRunning] = useState(false);
  const [cwAggregatesProgress, setCwAggregatesProgress] = useState(0);
  const [cwAggregatesResult, setCwAggregatesResult] = useState<
    Record<string, unknown> | null
  >(null);
  const [cwAggregatesError, setCwAggregatesError] = useState<string | null>(
    null
  );

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
  const [dynamoHistoryError, setDynamoHistoryError] = useState<string | null>(
    null
  );
  const [selectedDynamoReextractMonths, setSelectedDynamoReextractMonths] =
    useState<Set<string>>(new Set([ANALYSIS_MONTH_STRING]));
  const [dynamoReextractRunning, setDynamoReextractRunning] = useState(false);
  const [dynamoReextractResult, setDynamoReextractResult] = useState<
    Record<string, { inserted: number; updated: number }> | null
  >(null);
  const [dynamoReextractError, setDynamoReextractError] = useState<string | null>(
    null
  );
  const [dynamoIncrementalRunning, setDynamoIncrementalRunning] = useState(false);
  const [dynamoIncrementalResult, setDynamoIncrementalResult] = useState<{
    inserted: number;
    updated: number;
    processed: number;
    newWatermark: string | null;
    message?: string;
  } | null>(null);
  const [dynamoIncrementalError, setDynamoIncrementalError] = useState<
    string | null
  >(null);
  const [incrementalInngestTriggering, setIncrementalInngestTriggering] =
    useState(false);
  const [loadFromDateInngestTriggering, setLoadFromDateInngestTriggering] =
    useState(false);
  const [loadFromDateInngestJobId, setLoadFromDateInngestJobId] = useState<
    Id<"pipelineJobs"> | null
  >(null);
  const [fechaTransaccionSinceDate, setFechaTransaccionSinceDate] =
    useState("2024-01-01");
  const [fechaTransaccionFullInngestTriggering, setFechaTransaccionFullInngestTriggering] =
    useState(false);
  const [fechaTransaccionFromDateInngestTriggering, setFechaTransaccionFromDateInngestTriggering] =
    useState(false);
  const [fechaTransaccionFromDateInngestJobId, setFechaTransaccionFromDateInngestJobId] =
    useState<Id<"pipelineJobs"> | null>(null);

  const [selectedDatamappingMonths, setSelectedDatamappingMonths] = useState<
    Set<string>
  >(new Set([ANALYSIS_MONTH_STRING]));
  const [dmAggregatesRunning, setDmAggregatesRunning] = useState(false);
  const [dmAggregatesResult, setDmAggregatesResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [dmAggregatesError, setDmAggregatesError] = useState<string | null>(
    null
  );

  const [pipelineJobsRefresh, setPipelineJobsRefresh] = useState(0);
  const [pipelineJobsCursor, setPipelineJobsCursor] = useState<string | null>(
    null
  );
  const [selectedJobId, setSelectedJobId] = useState<Id<"pipelineJobs"> | null>(
    null
  );

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

  const pipelineJobsResult = useQuery(
    api.pipelineJobs.listPipelineJobs,
    {
      paginationOpts: {
        numItems: 50,
        cursor: pipelineJobsCursor ?? null,
      },
      _refresh: pipelineJobsRefresh,
    }
  );
  const selectedPipelineJob = useQuery(
    api.pipelineJobs.getPipelineJob,
    selectedJobId ? { jobId: selectedJobId } : "skip"
  );

  const fetchAndIngest = useAction(api.actions.fetchAndIngestForDate);
  const buildAggregates = useAction(api.januaryETL.buildJanuaryAggregates);
  const fetchDatamappingAndIngest = useAction(
    api.actions.fetchDatamappingAndIngest
  );
  const fetchDatamappingForMonth = useAction(
    api.actions.fetchDatamappingForMonth
  );
  const fetchDatamappingIncremental = useAction(
    api.actions.fetchDatamappingIncremental
  );
  const buildDatamappingAggregates = useAction(
    api.datamappingETL.buildDatamappingAggregates
  );
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

  const [dynamoHistoryTriggering, setDynamoHistoryTriggering] = useState(false);
  const handleDynamoFullHistory = useCallback(async (): Promise<void> => {
    setDynamoHistoryError(null);
    setDynamoHistoryTriggering(true);
    try {
      const res = await fetch("/api/datamapping/full-history", {
        method: "POST",
      });
      const text = await res.text();
      let data: { ok?: boolean; error?: string } = {};
      try {
        data = JSON.parse(text) as { ok?: boolean; error?: string };
      } catch {
        // Respuesta no-JSON (p. ej. HTML de Cloudflare 524)
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
      const res = await fetch("/api/datamapping/incremental", {
        method: "POST",
      });
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

  const toggleDatamappingMonth = (month: string): void => {
    setSelectedDatamappingMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

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

  const toggleMonth = (month: string): void => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  const pipelineJobs =
    pipelineJobsResult?.page ?? ([] as Doc<"pipelineJobs">[]);
  const pipelineJobsIsDone = pipelineJobsResult?.isDone ?? true;
  const pipelineJobsContinueCursor = pipelineJobsResult?.continueCursor ?? null;

  return (
    <div
      className="min-h-screen bg-january bg-grid p-6 md:p-8"
      suppressHydrationWarning
    >
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-space-grotesk gradient-text-emerald flex items-center gap-2">
            <ListTodo className="size-8" />
            Jobs
          </h1>
          <p className="text-muted-foreground mt-1">
            Ejecuta cargas, extracciones, agregaciones y enriquecimiento de
            datos.
          </p>
        </div>

        {/* 1. Pipeline Jobs */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Pipeline Jobs</h2>
              <p className="text-sm text-muted-foreground">
                Estado de jobs de Inngest y acciones async (vacío hasta que se
                implemente el disparo vía Inngest).
              </p>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => setPipelineJobsRefresh((k) => k + 1)}
              title="Actualizar estado"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          {pipelineJobsResult === undefined ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : pipelineJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay jobs registrados.
            </p>
          ) : (
            <>
              <div className="rounded-md border border-slate-700 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-xs text-muted-foreground">
                        Tipo
                      </TableHead>
                      <TableHead className="text-xs text-muted-foreground">
                        Estado
                      </TableHead>
                      <TableHead className="text-xs text-muted-foreground">
                        Progreso
                      </TableHead>
                      <TableHead className="text-xs text-muted-foreground">
                        Inicio
                      </TableHead>
                      <TableHead className="text-xs text-muted-foreground w-20">
                        Acción
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pipelineJobs.map((job) => (
                      <TableRow
                        key={job._id}
                        className="border-slate-700 cursor-pointer hover:bg-slate-800/50"
                        onClick={() => setSelectedJobId(job._id)}
                      >
                        <TableCell className="text-xs py-2">
                          {job.jobType}
                        </TableCell>
                        <TableCell className="text-xs py-2">
                          <StatusBadge status={job.status} />
                        </TableCell>
                        <TableCell className="text-xs py-2">
                          {job.progress?.total != null &&
                          job.progress.current != null ? (
                            <Progress
                              value={
                                (job.progress.current / job.progress.total) *
                                100
                              }
                              className="h-2 w-20"
                            />
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-2">
                          {new Date(job.startedAt).toLocaleString(undefined, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </TableCell>
                        <TableCell className="py-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedJobId(job._id);
                            }}
                          >
                            Detalle
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!pipelineJobsIsDone && pipelineJobsContinueCursor && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPipelineJobsCursor(pipelineJobsContinueCursor)
                  }
                  className="bg-white/3 border-border/50"
                >
                  Cargar más
                </Button>
              )}
            </>
          )}
        </div>

        {/* 2. Datamapping (DynamoDB) */}
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

          {/* 4a. Histórico completo */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              1. Histórico completo (desde {DATAMAPPING_HISTORY_START})
            </h3>
            <p className="text-xs text-muted-foreground">
              Dispara job en Inngest (1 ejecución por mes, en paralelo). Portal
              Durango entró en operación ene 2024. Avance persistido en Convex
              (independiente de refresh/navegación).
            </p>
            <Button
              size="sm"
              onClick={handleDynamoFullHistory}
              disabled={
                dynamoHistoryTriggering ||
                (latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running") ||
                (latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running") ||
                dynamoReextractRunning ||
                dynamoIncrementalRunning ||
                dynamoLoading ||
                syncing
              }
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

          {/* 4b. Re-extraer período */}
          <div className="space-y-2 border-t border-slate-700/50 pt-4">
            <h3 className="text-sm font-medium">2. Re-extraer período</h3>
            <p className="text-xs text-muted-foreground">
              Re-extrae meses seleccionados (upsert: actualiza registros
              modificados).
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
                (latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running") ||
                (latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running") ||
                dynamoIncrementalRunning ||
                dynamoLoading ||
                syncing
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
              <div className="text-sm text-destructive">
                {dynamoReextractError}
              </div>
            )}
          </div>

          {/* 4c. Incremental */}
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
                disabled={
                  dynamoIncrementalRunning ||
                  (latestDatamappingClearJob?.status === "pending" ||
                  latestDatamappingClearJob?.status === "running") ||
                  (latestDatamappingFullHistoryJob?.status === "pending" ||
                  latestDatamappingFullHistoryJob?.status === "running") ||
                  dynamoReextractRunning ||
                  dynamoLoading ||
                  syncing
                }
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
                disabled={
                  incrementalInngestTriggering ||
                  (latestDatamappingClearJob?.status === "pending" ||
                  latestDatamappingClearJob?.status === "running") ||
                  (latestDatamappingFullHistoryJob?.status === "pending" ||
                  latestDatamappingFullHistoryJob?.status === "running") ||
                  dynamoReextractRunning ||
                  dynamoLoading ||
                  syncing
                }
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
              <div className="text-sm text-destructive">
                {dynamoIncrementalError}
              </div>
            )}
          </div>

          {/* 4d. Carga manual (legacy) + Borrar */}
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
              disabled={
                dynamoLoading ||
                (latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running") ||
                (latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running") ||
                dynamoReextractRunning ||
                dynamoIncrementalRunning ||
                syncing
              }
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
              disabled={
                loadFromDateInngestTriggering ||
                dynamoLoading ||
                (latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running") ||
                (latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running") ||
                dynamoReextractRunning ||
                dynamoIncrementalRunning ||
                syncing
              }
              className="gap-2 bg-white/3 border-border/50"
            >
              {loadFromDateInngestTriggering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Cargar desde fecha (Inngest)"
              )}
            </Button>
            {loadFromDateInngestJobId && (
              <span className="text-xs text-muted-foreground">
                Job creado. Ver en lista de jobs abajo.
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDynamoDeleteDialogOpen(true)}
              disabled={
                dynamoLoading ||
                dynamoClearTriggering ||
                (latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running") ||
                (latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running") ||
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

          {/* 4e. Backfill fechaTransaccion (DataMapping) */}
          <div className="flex flex-wrap gap-4 items-end border-t border-slate-700/50 pt-4">
            <h3 className="text-sm font-medium w-full">4e. Backfill fechaTransaccion (DataMapping)</h3>
            <p className="text-xs text-muted-foreground w-full -mt-2">
              Llena fechaTransaccion desde paymentRecords (por referencia); fallback a updatedAt si no existe en CloudWatch.
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
              disabled={
                fechaTransaccionFullInngestTriggering ||
                (latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running") ||
                (latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running") ||
                (latestFechaTransaccionFullJob?.status === "pending" ||
                latestFechaTransaccionFullJob?.status === "running") ||
                dynamoReextractRunning ||
                dynamoIncrementalRunning ||
                dynamoLoading ||
                syncing
              }
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
              disabled={
                fechaTransaccionFromDateInngestTriggering ||
                (latestDatamappingClearJob?.status === "pending" ||
                latestDatamappingClearJob?.status === "running") ||
                (latestDatamappingFullHistoryJob?.status === "pending" ||
                latestDatamappingFullHistoryJob?.status === "running") ||
                (latestFechaTransaccionFullJob?.status === "pending" ||
                latestFechaTransaccionFullJob?.status === "running") ||
                dynamoReextractRunning ||
                dynamoIncrementalRunning ||
                dynamoLoading ||
                syncing
              }
              className="gap-2 bg-white/3 border-border/50"
            >
              {fechaTransaccionFromDateInngestTriggering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Llenar desde fecha (Inngest)
            </Button>
            {fechaTransaccionFromDateInngestJobId && (
              <span className="text-xs text-muted-foreground">
                Job creado. Ver en lista de jobs abajo.
              </span>
            )}
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
              Carga manual: {dynamoResult.totalInserted} ins,{" "}
              {dynamoResult.totalUpdated} act
            </div>
          )}
          {dynamoError && !dynamoLoading && (
            <div className="text-sm text-destructive">{dynamoError}</div>
          )}
        </div>

        {/* 3. Agregados DataMapping */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold">Agregados DataMapping</h3>
          <p className="text-xs text-muted-foreground">
            Genera tablas agregadas desde datamappingRecords para Análisis
            Mensual/Anual con fuente DataMapping.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSelectedDatamappingMonths(new Set(ALL_MONTHS))
              }
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
              dmAggregatesRunning ||
              selectedDatamappingMonths.size === 0 ||
              dynamoLoading
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

        {/* 4. Enriquecimiento = en la carga */}
        <div className="glass-card rounded-xl p-6 space-y-2">
          <h3 className="text-sm font-semibold">Enriquecimiento (en la carga)</h3>
          <p className="text-xs text-muted-foreground">
            La carga desde DynamoDB ya incluye enriquecimiento en un solo paso: se
            extraen RFC, placa, evoId, codiId, expirationDate, folioNumber, loteId,
            procedureCategory, tramiteId y userId del rawJson y se guardan en cada
            registro. No hace falta ejecutar enriquecimiento ni backfill por
            separado. Búsqueda por RFC en{" "}
            <Link
              href="/reconcile/rfc-referencias"
              className="text-emerald-400 hover:text-emerald-300"
            >
              RFC Referencias
            </Link>
            .
          </p>
        </div>

        {/* 5. Sincronizar CloudWatch */}
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
              <label className="text-xs text-muted-foreground">
                Período desde
              </label>
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

        {/* 7. Agregados CloudWatch */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Agregados CloudWatch</h2>
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
              datamappingRecords y la marca de agua. Podrás ver el avance en la
              UI y volver a cargar desde DynamoDB después.
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

      <Dialog
        open={selectedJobId != null}
        onOpenChange={(open) => !open && setSelectedJobId(null)}
      >
        <DialogContent className="glass-card-elevated border-border/50 max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Detalle del job</DialogTitle>
          </DialogHeader>
          {selectedPipelineJob ? (
            <div className="space-y-2 text-sm overflow-y-auto min-h-0 flex-1 pr-1">
              <p>
                <span className="text-muted-foreground">Tipo:</span>{" "}
                {selectedPipelineJob.jobType}
              </p>
              <p>
                <span className="text-muted-foreground">Estado:</span>{" "}
                <StatusBadge status={selectedPipelineJob.status} />
              </p>
              <div>
                <p>
                  <span className="text-muted-foreground">Scope:</span>
                </p>
                <pre className="text-xs overflow-auto bg-slate-800/50 p-2 rounded mt-1 max-h-24">
                  {JSON.stringify(selectedPipelineJob.scope, null, 2)}
                </pre>
              </div>
              {selectedPipelineJob.progress && (
                <p>
                  <span className="text-muted-foreground">Progreso:</span>{" "}
                  {selectedPipelineJob.progress.current}
                  {selectedPipelineJob.progress.total != null &&
                    ` / ${selectedPipelineJob.progress.total}`}{" "}
                  {selectedPipelineJob.progress.unit ?? ""}
                  {selectedPipelineJob.progress.message &&
                    ` — ${selectedPipelineJob.progress.message}`}
                </p>
              )}
              {selectedPipelineJob.result && (
                <div>
                  <p>
                    <span className="text-muted-foreground">Resultado:</span>
                  </p>
                  {(() => {
                    const r = selectedPipelineJob.result as Record<string, unknown>;
                    const hasSummary =
                      r.summary != null ||
                      (Array.isArray(r.completedMonths) && Array.isArray(r.failedMonths));
                    return (
                      <>
                        {hasSummary && (
                          <div className="bg-slate-800/50 p-3 rounded mt-1 space-y-1.5 text-xs">
                            {typeof r.summary === "string" && (
                              <p className="font-medium text-emerald-400">{r.summary}</p>
                            )}
                            {typeof r.totalInserted === "number" &&
                              typeof r.totalUpdated === "number" && (
                              <p>
                                Total: {r.totalInserted} insertados, {r.totalUpdated}{" "}
                                actualizados
                              </p>
                            )}
                            {Array.isArray(r.completedMonths) &&
                              r.completedMonths.length > 0 && (
                              <p>
                                Meses ok: {r.completedMonths.length}{" "}
                                ({String(r.completedMonths[0])}
                                {r.completedMonths.length > 1 ? " … " + String(r.completedMonths[r.completedMonths.length - 1]) : ""})
                              </p>
                            )}
                            {Array.isArray(r.failedMonths) &&
                              r.failedMonths.length > 0 && (
                              <div className="text-destructive">
                                <p className="font-medium">
                                  Meses fallidos ({r.failedMonths.length}):
                                </p>
                                <ul className="list-disc list-inside mt-0.5">
                                  {(r.failedMonths as Array<{ ym?: string; error?: string }>).map(
                                    (f, i) => (
                                      <li key={i}>
                                        {f.ym ?? String(f)}: {(f as { error?: string }).error ?? ""}
                                      </li>
                                    )
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                        <pre className="text-xs overflow-auto bg-slate-800/50 p-2 rounded mt-1 max-h-[200px] border border-slate-700/50">
                          {JSON.stringify(selectedPipelineJob.result, null, 2)}
                        </pre>
                      </>
                    );
                  })()}
                </div>
              )}
              {selectedPipelineJob.errorMessage && (
                <p className="whitespace-pre-wrap break-words">
                  <span className="text-destructive">Error:</span>{" "}
                  {formatErrorMessage(selectedPipelineJob.errorMessage)}
                </p>
              )}
              <p>
                <span className="text-muted-foreground">Inicio:</span>{" "}
                {new Date(selectedPipelineJob.startedAt).toLocaleString()}
              </p>
              {selectedPipelineJob.completedAt && (
                <p>
                  <span className="text-muted-foreground">Fin:</span>{" "}
                  {new Date(selectedPipelineJob.completedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Cargando...</p>
          )}
          <DialogFooter className="shrink-0">
            <Button
              variant="outline"
              onClick={() => setSelectedJobId(null)}
              size="sm"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
