"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
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
import { Upload, Loader2, Save, Plus, Trash2, RefreshCw, Database } from "lucide-react";
import { SyncDialog } from "@/components/dashboard/SyncDialog";
import { IngestionStatus } from "@/components/dashboard/IngestionStatus";
import {
  PERIOD_START,
  PERIOD_END,
  PERIOD_START_DATE,
  PERIOD_END_DATE,
  generateMonthRange,
  generateDateRange,
  ANALYSIS_MONTH_STRING,
} from "@/lib/constants";

const ALL_MONTHS = generateMonthRange(PERIOD_START, PERIOD_END);
const SYNC_STORAGE_KEY = "reconciliation-sync-in-progress";

export default function UploadPage(): React.ReactElement {
  const [startDate, setStartDate] = useState(PERIOD_START_DATE);
  const [endDate, setEndDate] = useState(PERIOD_END_DATE);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(
    new Set([ANALYSIS_MONTH_STRING])
  );
  const [running, setRunning] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [newCodigo, setNewCodigo] = useState("");
  const [newDescripcion, setNewDescripcion] = useState("");
  const [newAliasVariante, setNewAliasVariante] = useState("");
  const [newAliasCodigo, setNewAliasCodigo] = useState("");
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteMonthDialogOpen, setDeleteMonthDialogOpen] = useState(false);
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
  const [deleting, setDeleting] = useState(false);
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
  const [dynamoDeleting, setDynamoDeleting] = useState(false);
  const [dynamoDeleteDialogOpen, setDynamoDeleteDialogOpen] = useState(false);
  const [dynamoByDayStatus, setDynamoByDayStatus] = useState<
    Record<number, "idle" | "loading" | "done" | "error">
  >(() => {
    const o: Record<number, "idle" | "loading" | "done" | "error"> = {};
    for (let d = 1; d <= 31; d++) o[d] = "idle";
    return o;
  });
  const [dynamoByDayResult, setDynamoByDayResult] = useState<
    Record<number, { inserted: number; updated: number }>
  >({});
  const [dynamoExtractAllRunning, setDynamoExtractAllRunning] = useState(false);
  const [dynamoExtractCurrentDay, setDynamoExtractCurrentDay] = useState(0);
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
      // Ignorar errores de localStorage (SSR, modo privado)
    }
  }, []);

  const allMonthsStatus = useQuery(api.queries.getAllMonthsStatus, {});
  const selectedMonthStats = useQuery(
    api.queries.getMonthStats,
    selectedMonth ? { month: selectedMonth } : "skip"
  );
  const codes = useQuery(api.movementCodes.listMovementCodes);
  const aliases = useQuery(api.movementCodes.listMovementAliases);
  const buildAggregates = useAction(api.januaryETL.buildJanuaryAggregates);
  const seedMovementCodes = useMutation(api.movementCodes.seedMovementCodes);
  const upsertCode = useMutation(api.movementCodes.upsertMovementCode);
  const deleteCode = useMutation(api.movementCodes.deleteMovementCode);
  const upsertAlias = useMutation(api.movementCodes.upsertMovementAlias);
  const deleteAlias = useMutation(api.movementCodes.deleteMovementAlias);
  const fetchAndIngest = useAction(api.actions.fetchAndIngestForDate);
  const deletePaymentsByMonth = useMutation(api.mutations.deletePaymentsByMonth);
  const deleteMonthStats = useMutation(api.mutations.deleteMonthStats);
  const fetchDatamappingAndIngest = useAction(
    api.actions.fetchDatamappingAndIngest
  );
  const fetchDatamappingForDay = useAction(
    api.actions.fetchDatamappingForDay
  );
  const deleteDatamappingBatch = useMutation(
    api.mutations.deleteDatamappingRecordsBatch
  );
  const buildDatamappingAggregates = useAction(
    api.datamappingETL.buildDatamappingAggregates
  );

  const [effectiveStart, effectiveEnd] =
    startDate && endDate && startDate <= endDate
      ? [startDate, endDate]
      : startDate && endDate
        ? [endDate, startDate]
        : [PERIOD_START_DATE, PERIOD_END_DATE];
  const periodDates = generateDateRange(effectiveStart, effectiveEnd);

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
      // Ignorar si localStorage no está disponible
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
          ? `Días con error (${failedDays.length}): ${failedDays.slice(0, 5).join(", ")}${failedDays.length > 5 ? "..." : ""}. Límite 600s/día. Reintenta esos días.`
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
        if (res.hasMore) {
          setDynamoResult({
            inserted: res.inserted,
            updated: res.updated,
            pageCount: pageIndex,
            totalInserted,
            totalUpdated,
          });
        } else {
          setDynamoResult({
            inserted: res.inserted,
            updated: res.updated,
            pageCount: pageIndex,
            totalInserted,
            totalUpdated,
          });
          break;
        }
      } while (exclusiveStartKey);
    } catch (err) {
      setDynamoError(err instanceof Error ? err.message : "Error al cargar DynamoDB");
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

  const handleDynamoExtractAllJanuary = useCallback(async (): Promise<void> => {
    setDynamoExtractAllRunning(true);
    setDynamoError(null);
    const year = 2026;
    const month = 1;
    for (let day = 1; day <= 31; day++) {
      setDynamoExtractCurrentDay(day);
      setDynamoByDayStatus((prev) => ({ ...prev, [day]: "loading" }));
      try {
        const res = await fetchDatamappingForDay({ year, month, day });
        setDynamoByDayStatus((prev) => ({ ...prev, [day]: "done" }));
        setDynamoByDayResult((prev) => ({
          ...prev,
          [day]: { inserted: res.inserted, updated: res.updated },
        }));
      } catch (err) {
        setDynamoByDayStatus((prev) => ({ ...prev, [day]: "error" }));
        setDynamoError(
          err instanceof Error ? err.message : `Error día ${day}`
        );
      }
    }
    setDynamoExtractCurrentDay(0);
    setDynamoExtractAllRunning(false);
  }, [fetchDatamappingForDay]);

  const handleDeleteDynamo = useCallback(async (): Promise<void> => {
    setDynamoDeleting(true);
    setDynamoResult(null);
    setDynamoError(null);
    try {
      let totalDeleted = 0;
      while (true) {
        const res = await deleteDatamappingBatch({});
        totalDeleted += res.deleted;
        if (res.deleted === 0) break;
      }
      setDynamoDeleteDialogOpen(false);
    } catch (err) {
      setDynamoError(err instanceof Error ? err.message : "Error al borrar");
    } finally {
      setDynamoDeleting(false);
    }
  }, [deleteDatamappingBatch]);

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

  const handleDeleteAll = useCallback(async (): Promise<void> => {
    setDeleting(true);
    try {
      const allMonthsToDelete = ALL_MONTHS;
      for (const month of allMonthsToDelete) {
        while (true) {
          const res = await deletePaymentsByMonth({ month });
          if (res.deleted === 0) break;
        }
        await deleteMonthStats({ month });
      }
      setDeleteDialogOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  }, [deletePaymentsByMonth, deleteMonthStats]);

  const handleDeleteMonth = useCallback(
    async (month: string): Promise<void> => {
      setDeleting(true);
      try {
        while (true) {
          const res = await deletePaymentsByMonth({ month });
          if (res.deleted === 0) break;
        }
        await deleteMonthStats({ month });
        setDeleteMonthDialogOpen(false);
        setSelectedMonth(null);
      } catch (err) {
        console.error(err);
      } finally {
        setDeleting(false);
      }
    },
    [deletePaymentsByMonth, deleteMonthStats]
  );

  const toggleMonth = (month: string): void => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  const handleSeedMovementCodes = async (): Promise<void> => {
    setSeeding(true);
    setError(null);
    try {
      const res = await seedMovementCodes({});
      setResult(res as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSeeding(false);
    }
  };

  const handleEdit = (codigo: string, descripcion: string): void => {
    setEditing(codigo);
    setEditDesc(descripcion);
  };

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    setError(null);
    try {
      await upsertCode({ codigo: editing, descripcion: editDesc });
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const handleCancelEdit = (): void => {
    setEditing(null);
    setEditDesc("");
  };

  const handleDeleteCode = async (codigo: string): Promise<void> => {
    setError(null);
    try {
      await deleteCode({ codigo });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const handleAdd = async (): Promise<void> => {
    const cod = newCodigo.trim().toUpperCase();
    const desc = newDescripcion.trim();
    if (!cod || !desc) return;
    setError(null);
    try {
      await upsertCode({ codigo: cod, descripcion: desc });
      setNewCodigo("");
      setNewDescripcion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al agregar");
    }
  };

  const handleAddAlias = async (): Promise<void> => {
    const variante = newAliasVariante.trim().toUpperCase();
    const codigo = newAliasCodigo.trim().toUpperCase();
    if (!variante || !codigo) return;
    setError(null);
    try {
      await upsertAlias({ variante, codigoCanonico: codigo });
      setNewAliasVariante("");
      setNewAliasCodigo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al agregar alias");
    }
  };

  const handleDeleteAlias = async (variante: string): Promise<void> => {
    setError(null);
    try {
      await deleteAlias({ variante });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar alias");
    }
  };

  const handleBuild = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(10);

    try {
      const months = Array.from(selectedMonths);
      setProgress(30);
      const res = await buildAggregates({ months });
      setProgress(100);
      setResult(res as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-january bg-grid p-6 md:p-8"
      suppressHydrationWarning
    >
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-space-grotesk gradient-text-emerald">
            Gestión de datos
          </h1>
          <p className="text-muted-foreground mt-1">
            Carga datos desde CloudWatch, genera tablas agregadas y gestiona
            códigos de movimiento.
          </p>
        </div>

        {/* Carga de datos - siempre visible */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Carga de datos</h2>
          <p className="text-sm text-muted-foreground">
            Sincroniza desde CloudWatch por período o borra todos los datos.
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
            <div className="flex flex-wrap gap-2">
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={syncing}
                className="gap-2 bg-white/3 border-border/50 text-red-400 hover:text-red-300"
              >
                <Trash2 className="size-3.5" />
                Borrar Todo
              </Button>
            </div>
          </div>
        </div>

        {/* Carga desde DynamoDB (reconciliación datamapping) */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
            <Database className="size-5" />
            Carga desde DynamoDB
            <Link
              href="/reconcile/january-2026"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-normal text-emerald-400 hover:text-emerald-300 ml-auto"
            >
              Reconciliar →
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground">
            Consulta la tabla de datamapping (backup Prod) por GSI DateIndex:
            registros con <code className="text-xs bg-muted px-1 rounded">status = PAGO VALIDADO</code> y{" "}
            <code className="text-xs bg-muted px-1 rounded">updatedAt</code> posterior a la fecha. Se guardan en{" "}
            <code className="text-xs bg-muted px-1 rounded">datamappingRecords</code> para reconciliar con CloudWatch.
          </p>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                updatedAt posterior a (fecha)
              </label>
              <input
                type="date"
                value={dynamoSinceDate}
                onChange={(e) => setDynamoSinceDate(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={handleLoadDynamo}
                disabled={dynamoLoading || syncing}
                className="gap-2 bg-amber-600 hover:bg-amber-700"
              >
                {dynamoLoading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {dynamoProgressPage > 0
                      ? `Página ${dynamoProgressPage}...`
                      : "Cargando..."}
                  </>
                ) : (
                  <>
                    <Database className="size-3.5" />
                    Cargar desde DynamoDB
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDynamoDeleteDialogOpen(true)}
                disabled={dynamoLoading || dynamoDeleting || syncing}
                className="gap-2 bg-white/3 border-border/50 text-red-400 hover:text-red-300"
              >
                {dynamoDeleting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Borrar datos DynamoDB
              </Button>
            </div>
          </div>
          {dynamoResult && !dynamoLoading && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 text-sm text-emerald-400">
              <p className="font-medium">Carga completada</p>
              <p className="mt-1">
                Total insertados: {dynamoResult.totalInserted} · Total
                actualizados: {dynamoResult.totalUpdated} · Páginas procesadas:{" "}
                {dynamoResult.pageCount}.
              </p>
            </div>
          )}

          <div className="border-t border-slate-700/50 pt-4 mt-4">
            <h3 className="text-sm font-semibold mb-2">
              Extracción por día (Enero 2026, ~70k registros)
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Extrae por día (updatedAt en ese día). Los registros existentes se
              re-escriben (upsert por referencia + updatedAt), no se borran.
            </p>
            <Button
              size="sm"
              onClick={handleDynamoExtractAllJanuary}
              disabled={
                dynamoExtractAllRunning ||
                dynamoLoading ||
                syncing
              }
              className="gap-2 bg-amber-600 hover:bg-amber-700 mb-3"
            >
              {dynamoExtractAllRunning ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Día {dynamoExtractCurrentDay} de 31...
                </>
              ) : (
                <>
                  <Database className="size-3.5" />
                  Extraer todo enero 2026 por día
                </>
              )}
            </Button>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                const status = dynamoByDayStatus[day];
                const result = dynamoByDayResult[day];
                return (
                  <div
                    key={day}
                    className={`
                      flex flex-col items-center justify-center w-9 h-9 rounded border text-xs
                      ${
                        status === "done"
                          ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                          : status === "loading"
                            ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                            : status === "error"
                              ? "bg-destructive/20 border-destructive/50 text-destructive"
                              : "bg-slate-800/50 border-slate-600 text-muted-foreground"
                      }
                    `}
                    title={
                      result
                        ? `Día ${day}: +${result.inserted} ins, ${result.updated} act`
                        : `Día ${day}: ${status}`
                    }
                  >
                    <span>{day}</span>
                    {result && (
                      <span className="text-[10px] opacity-80">
                        {result.inserted + result.updated}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {dynamoError && !dynamoLoading && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
              {dynamoError}
            </div>
          )}

          <div className="border-t border-slate-700/50 pt-4 mt-4">
            <h3 className="text-sm font-semibold mb-2">
              Agregaciones DataMapping (Análisis Mensual / Anual)
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Genera tablas agregadas desde <code className="text-xs bg-muted px-1 rounded">datamappingRecords</code> para
              visualizar en Análisis Mensual y Anual con fuente DataMapping.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
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
                  Generando agregaciones...
                </>
              ) : (
                <>
                  <Database className="size-3.5" />
                  Generar tablas agregadas (DataMapping)
                </>
              )}
            </Button>
            {dmAggregatesResult && !dmAggregatesRunning && (
              <div className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Agregaciones completadas</p>
                <pre className="text-xs mt-1 overflow-auto">
                  {JSON.stringify(dmAggregatesResult, null, 2)}
                </pre>
              </div>
            )}
            {dmAggregatesError && !dmAggregatesRunning && (
              <div className="mt-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {dmAggregatesError}
              </div>
            )}
          </div>
        </div>

        {/* Registros Cargados - grilla de meses */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold">Registros cargados</h2>
            {selectedMonth && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteMonthDialogOpen(true)}
                disabled={syncing || deleting}
                className="gap-2 bg-white/3 border-border/50 text-red-400 hover:text-red-300"
              >
                <Trash2 className="size-3.5" />
                Borrar mes {selectedMonth}
              </Button>
            )}
          </div>
          {allMonthsStatus ? (
            <IngestionStatus
              allMonthsStatus={allMonthsStatus}
              selectedMonth={selectedMonth}
              selectedMonthDetail={
                selectedMonth && selectedMonthStats?.ingestionStatus
                  ? {
                      totalRecords: selectedMonthStats.ingestionStatus.totalRecords,
                      daysWithData: selectedMonthStats.ingestionStatus.daysWithData,
                      byDate: selectedMonthStats.ingestionStatus.byDate,
                    }
                  : undefined
              }
              onMonthSelect={setSelectedMonth}
            />
          ) : (
            <div className="glass-card rounded-xl p-5 text-muted-foreground text-sm">
              Cargando...
            </div>
          )}
        </section>

        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Meses a procesar</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedMonths(new Set(ALL_MONTHS))}
              disabled={running}
              className="bg-white/3 border-border/50"
            >
              Seleccionar todos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedMonths(new Set())}
              disabled={running}
              className="bg-white/3 border-border/50"
            >
              Deseleccionar todos
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_MONTHS.map((m) => (
              <label
                key={m}
                className="flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border border-slate-700/50 hover:bg-slate-800/30"
              >
                <input
                  type="checkbox"
                  checked={selectedMonths.has(m)}
                  onChange={() => toggleMonth(m)}
                  disabled={running}
                  className="rounded"
                  suppressHydrationWarning
                />
                <span>{m}</span>
              </label>
            ))}
          </div>

          <Button
            onClick={handleBuild}
            disabled={running || selectedMonths.size === 0}
            className="w-full"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Procesando...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Generar tablas agregadas
              </>
            )}
          </Button>

          {running && <Progress value={progress} className="h-2" />}

          {error && (
            <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400">
              {error}
            </div>
          )}

          {result && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <p className="font-medium">Procesamiento completado</p>
              <pre className="text-xs mt-2 overflow-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Códigos y descripciones</h2>
          <p className="text-sm text-muted-foreground">
            Actualiza códigos y descripciones directamente aquí. Si la tabla está vacía, ejecuta
            el seed primero.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSeedMovementCodes}
            disabled={seeding}
          >
            {seeding ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Sembrando...
              </>
            ) : (
              "Sembrar códigos iniciales"
            )}
          </Button>

          <div className="rounded-lg border border-slate-700/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50">
                  <TableHead className="text-slate-300">Código</TableHead>
                  <TableHead className="text-slate-300">Descripción</TableHead>
                  <TableHead className="text-slate-300 w-28">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes === undefined ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                      Cargando...
                    </TableCell>
                  </TableRow>
                ) : codes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                      No hay códigos. Ejecuta el seed inicial.
                    </TableCell>
                  </TableRow>
                ) : (
                  codes.map((row) => (
                  <TableRow key={row.codigo} className="border-slate-700/50">
                    <TableCell className="font-mono text-sm">{row.codigo}</TableCell>
                    <TableCell>
                      {editing === row.codigo ? (
                        <input
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
                          autoFocus
                        />
                      ) : (
                        <span className="text-slate-200">{row.descripcion}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editing === row.codigo ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 p-1"
                            onClick={handleSave}
                          >
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 p-1"
                            onClick={handleCancelEdit}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 p-1"
                            onClick={() => handleEdit(row.codigo, row.descripcion)}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 p-1 text-rose-400 hover:text-rose-300"
                            onClick={() => handleDeleteCode(row.codigo)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap gap-2 items-end pt-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Código</label>
              <input
                value={newCodigo}
                onChange={(e) => setNewCodigo(e.target.value)}
                placeholder="ej. DENOM"
                className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground">Descripción</label>
              <input
                value={newDescripcion}
                onChange={(e) => setNewDescripcion(e.target.value)}
                placeholder="ej. Impuesto sobre nómina"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <Button size="sm" onClick={handleAdd} disabled={!newCodigo.trim() || !newDescripcion.trim()}>
              <Plus className="w-4 h-4 mr-1" />
              Agregar
            </Button>
          </div>
        </div>

        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Aliases (Payment → código)</h2>
          <p className="text-sm text-muted-foreground">
            Payment envía descripciones; los aliases mapean a códigos canónicos.
            Ej: &quot;IMPTO SOBRE NOMINA&quot; → DENOM. Añade aquí cuando veas duplicados.
          </p>
          <div className="rounded-lg border border-slate-700/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50">
                  <TableHead className="text-slate-300">Variante</TableHead>
                  <TableHead className="text-slate-300">Código canónico</TableHead>
                  <TableHead className="text-slate-300 w-20">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aliases === undefined ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                      Cargando...
                    </TableCell>
                  </TableRow>
                ) : aliases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                      No hay aliases. Ejecuta el seed o agrega manualmente.
                    </TableCell>
                  </TableRow>
                ) : (
                  aliases.map((row) => (
                    <TableRow key={row.variante} className="border-slate-700/50">
                      <TableCell className="font-mono text-sm">{row.variante}</TableCell>
                      <TableCell className="font-mono text-sm">{row.codigoCanonico}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 p-1 text-rose-400 hover:text-rose-300"
                          onClick={() => handleDeleteAlias(row.variante)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap gap-2 items-end pt-2">
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground">Variante (descripción Payment)</label>
              <input
                value={newAliasVariante}
                onChange={(e) => setNewAliasVariante(e.target.value)}
                placeholder="ej. IMPTO SOBRE NOMINA"
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Código</label>
              <input
                value={newAliasCodigo}
                onChange={(e) => setNewAliasCodigo(e.target.value)}
                placeholder="ej. DENOM"
                className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={handleAddAlias}
              disabled={!newAliasVariante.trim() || !newAliasCodigo.trim()}
            >
              <Plus className="w-4 h-4 mr-1" />
              Agregar
            </Button>
          </div>
        </div>

        <div className="glass-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Notas</h2>
          <p className="text-sm text-muted-foreground">
            Las tablas agregadas (rawHourlyData, dailyData, monthlyData, etc.) se
            generan desde paymentRecords. Asegúrate de tener datos cargados para
            los meses seleccionados antes de ejecutar.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Filtros aplicados: estatus PAGADO/PAGO VALIDADO, 1 referencia = 1
            pago.
          </p>
        </div>
      </div>

      {/* Dialogs */}
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
              Se eliminarán todos los registros de la tabla{" "}
              <code className="text-xs">datamappingRecords</code>. Puedes volver
              a cargar desde DynamoDB cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={handleDeleteDynamo}
              disabled={dynamoDeleting}
              size="sm"
            >
              {dynamoDeleting ? "Eliminando..." : "Eliminar"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDynamoDeleteDialogOpen(false)}
              disabled={dynamoDeleting}
              size="sm"
              className="bg-white/3 border-border/50"
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteMonthDialogOpen}
        onOpenChange={setDeleteMonthDialogOpen}
      >
        <DialogContent className="glass-card-elevated border-border/50">
          <DialogHeader>
            <DialogTitle>Borrar mes {selectedMonth}</DialogTitle>
            <DialogDescription>
              Se eliminarán todos los registros y estadísticas de {selectedMonth}.
              Esta acción no se puede deshacer. Los datos se pueden volver a
              sincronizar desde CloudWatch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() =>
                selectedMonth && handleDeleteMonth(selectedMonth)
              }
              disabled={deleting || !selectedMonth}
              size="sm"
            >
              {deleting ? "Eliminando..." : "Eliminar mes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteMonthDialogOpen(false)}
              disabled={deleting}
              size="sm"
              className="bg-white/3 border-border/50"
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="glass-card-elevated border-border/50">
          <DialogHeader>
            <DialogTitle>Borrar todo</DialogTitle>
            <DialogDescription>
              Se eliminarán todos los registros de pago y estadísticas de {PERIOD_START} a {PERIOD_END}.
              Esta acción no se puede deshacer. Los datos se pueden volver a
              sincronizar desde CloudWatch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={deleting}
              size="sm"
            >
              {deleting ? "Eliminando..." : "Eliminar todo"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
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
