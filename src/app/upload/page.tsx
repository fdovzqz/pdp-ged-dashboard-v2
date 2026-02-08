"use client";

import { useState, useCallback } from "react";
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
import { Upload, Loader2, Save, Plus, Trash2, RefreshCw } from "lucide-react";
import { SyncDialog } from "@/components/dashboard/SyncDialog";
import { IngestionStatus } from "@/components/dashboard/IngestionStatus";
import {
  PERIOD_START,
  PERIOD_END,
  generateMonthRange,
  ANALYSIS_MONTH_STRING,
} from "@/lib/constants";

const ALL_MONTHS = generateMonthRange(PERIOD_START, PERIOD_END);

export default function UploadPage(): React.ReactElement {
  const [startMonth, setStartMonth] = useState(PERIOD_START);
  const [endMonth, setEndMonth] = useState(PERIOD_END);
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
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncCurrentDay, setSyncCurrentDay] = useState(0);
  const [syncCurrentMonth, setSyncCurrentMonth] = useState<string>("");
  const [syncCurrentMonthIndex, setSyncCurrentMonthIndex] = useState(0);
  const [syncTotalDays, setSyncTotalDays] = useState(0);
  const [syncResults, setSyncResults] = useState<{
    inserted: number;
    deleted: number;
    failedDays?: string[];
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const periodMonths = generateMonthRange(startMonth, endMonth);
  const totalDaysInPeriod = periodMonths.reduce((acc, month) => {
    const [y, m] = month.split("-").map(Number);
    return acc + new Date(y, m, 0).getDate();
  }, 0);

  const daysInFirstMonth =
    periodMonths.length > 0
      ? (() => {
          const [y, m] = periodMonths[0].split("-").map(Number);
          return new Date(y, m, 0).getDate();
        })()
      : 31;

  const handleStartSync = useCallback(async (): Promise<void> => {
    setSyncing(true);
    setSyncProgress(0);
    setSyncCurrentDay(0);
    setSyncResults(null);
    setSyncError(null);

    let totalInserted = 0;
    let totalDeleted = 0;
    const failedDays: string[] = [];
    let processedDays = 0;

    for (let monthIdx = 0; monthIdx < periodMonths.length; monthIdx++) {
      const month = periodMonths[monthIdx];
      const [y, m] = month.split("-").map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();

      setSyncCurrentMonth(month);
      setSyncCurrentMonthIndex(monthIdx + 1);
      setSyncTotalDays(daysInMonth);

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${month}-${String(d).padStart(2, "0")}`;
        setSyncCurrentDay(d);

        try {
          const res = await fetchAndIngest({ date: dateStr });
          totalInserted += res.inserted ?? 0;
          totalDeleted += res.deleted ?? 0;
        } catch {
          failedDays.push(dateStr);
        }

        processedDays += 1;
        setSyncProgress((processedDays / totalDaysInPeriod) * 100);
      }
    }

    setSyncResults({
      inserted: totalInserted,
      deleted: totalDeleted,
      ...(failedDays.length > 0 && { failedDays }),
    });
    setSyncError(
      failedDays.length > 0
        ? `Días con error (${failedDays.length}): ${failedDays.slice(0, 5).join(", ")}${failedDays.length > 5 ? "..." : ""}. Límite 600s/día. Reintenta esos días.`
        : null
    );
    setSyncing(false);
  }, [fetchAndIngest, periodMonths, totalDaysInPeriod]);

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
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
              >
                {ALL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">hasta</label>
              <select
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
              >
                {ALL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => setSyncDialogOpen(true)}
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

        {/* Registros Cargados - grilla de meses */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Registros cargados</h2>
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
        syncing={syncing}
        progress={syncProgress}
        currentDay={syncCurrentDay}
        totalDays={syncing ? syncTotalDays : daysInFirstMonth}
        results={syncResults}
        error={syncError}
        month={startMonth}
        startMonth={startMonth}
        endMonth={endMonth}
        currentMonth={syncCurrentMonth}
        currentMonthIndex={syncCurrentMonthIndex}
        totalMonths={periodMonths.length}
      />

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
