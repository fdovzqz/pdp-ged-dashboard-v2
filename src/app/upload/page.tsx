"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/button";
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
import { Upload, Loader2, Save, Plus, Trash2, ListTodo } from "lucide-react";
import { IngestionStatus } from "@/components/dashboard/IngestionStatus";
import {
  PERIOD_START,
  PERIOD_END,
  generateMonthRange,
} from "@/lib/constants";

const ALL_MONTHS = generateMonthRange(PERIOD_START, PERIOD_END);

export default function UploadPage(): React.ReactElement {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [newCodigo, setNewCodigo] = useState("");
  const [newDescripcion, setNewDescripcion] = useState("");
  const [newAliasVariante, setNewAliasVariante] = useState("");
  const [newAliasCodigo, setNewAliasCodigo] = useState("");
  const [deleteMonthDialogOpen, setDeleteMonthDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const allMonthsStatus = useQuery(api.queries.getAllMonthsStatus, {});
  const selectedMonthStats = useQuery(
    api.queries.getMonthStats,
    selectedMonth ? { month: selectedMonth } : "skip"
  );
  const codes = useQuery(api.movementCodes.listMovementCodes);
  const aliases = useQuery(api.movementCodes.listMovementAliases);
  const seedMovementCodes = useMutation(api.movementCodes.seedMovementCodes);
  const upsertCode = useMutation(api.movementCodes.upsertMovementCode);
  const deleteCode = useMutation(api.movementCodes.deleteMovementCode);
  const upsertAlias = useMutation(api.movementCodes.upsertMovementAlias);
  const deleteAlias = useMutation(api.movementCodes.deleteMovementAlias);
  const deletePaymentsByMonth = useMutation(api.mutations.deletePaymentsByMonth);
  const deleteMonthStats = useMutation(api.mutations.deleteMonthStats);

  const handleDeleteAll = async (): Promise<void> => {
    setDeleting(true);
    try {
      for (const month of ALL_MONTHS) {
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
  };

  const handleDeleteMonth = async (month: string): Promise<void> => {
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
            Registros cargados y configuración de códigos de movimiento.
            Ejecuta cargas, enriquecimiento y agregaciones en{" "}
            <Link
              href="/jobs"
              className="text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1"
            >
              <ListTodo className="size-4" />
              Jobs
            </Link>
            .
          </p>
        </div>

        {/* Registros cargados */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold">Registros cargados</h2>
            {selectedMonth && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteMonthDialogOpen(true)}
                disabled={deleting}
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
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleting}
              className="gap-2 bg-white/3 border-border/50 text-red-400 hover:text-red-300"
            >
              <Trash2 className="size-3.5" />
              Borrar Todo
            </Button>
          </div>
        </section>

        {/* Códigos y descripciones de movimiento */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Códigos y descripciones</h2>
          <p className="text-sm text-muted-foreground">
            Actualiza códigos y descripciones. Si la tabla está vacía, ejecuta
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
                <Loader2 className="size-3.5 animate-spin mr-2" />
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
                              <Save className="size-3.5" />
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
                              className="h-8 p-1 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteCode(row.codigo)}
                            >
                              <Trash2 className="size-3.5" />
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

          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="Código"
              value={newCodigo}
              onChange={(e) => setNewCodigo(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm w-24"
            />
            <input
              placeholder="Descripción"
              value={newDescripcion}
              onChange={(e) => setNewDescripcion(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm flex-1 min-w-[120px]"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAdd}
              disabled={!newCodigo.trim() || !newDescripcion.trim()}
              className="gap-1"
            >
              <Plus className="size-3.5" />
              Agregar
            </Button>
          </div>
        </div>

        {/* Aliases */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Aliases</h2>
          <p className="text-sm text-muted-foreground">
            Mapeo variante → código canónico (ej. REFRE → REFRENDO).
          </p>
          <div className="rounded-lg border border-slate-700/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50">
                  <TableHead className="text-slate-300">Variante</TableHead>
                  <TableHead className="text-slate-300">Código canónico</TableHead>
                  <TableHead className="text-slate-300 w-20">Acción</TableHead>
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
                      No hay aliases.
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
                          className="h-8 p-1 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteAlias(row.variante)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <input
              placeholder="Variante"
              value={newAliasVariante}
              onChange={(e) => setNewAliasVariante(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm w-32"
            />
            <input
              placeholder="Código canónico"
              value={newAliasCodigo}
              onChange={(e) => setNewAliasCodigo(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm w-32"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddAlias}
              disabled={!newAliasVariante.trim() || !newAliasCodigo.trim()}
              className="gap-1"
            >
              <Plus className="size-3.5" />
              Agregar
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
            {error}
          </div>
        )}
        {result && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 text-emerald-400 text-sm">
            <p className="font-medium">Seed completado</p>
            <pre className="text-xs mt-2 overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <Dialog open={deleteMonthDialogOpen} onOpenChange={setDeleteMonthDialogOpen}>
        <DialogContent className="glass-card-elevated border-border/50">
          <DialogHeader>
            <DialogTitle>Borrar mes {selectedMonth}</DialogTitle>
            <DialogDescription>
              Se eliminarán todos los registros y estadísticas de {selectedMonth}.
              Los datos se pueden volver a sincronizar desde Jobs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => selectedMonth && handleDeleteMonth(selectedMonth)}
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
              Los datos se pueden volver a sincronizar desde Jobs.
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
