"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Save, Plus, Trash2, CloudDownload, Layers } from "lucide-react";
export default function GestionDatosPage(): React.ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [newCodigo, setNewCodigo] = useState("");
  const [newDescripcion, setNewDescripcion] = useState("");
  const [newAliasVariante, setNewAliasVariante] = useState("");
  const [newAliasCodigo, setNewAliasCodigo] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const codes = useQuery(api.movementCodes.listMovementCodes);
  const aliases = useQuery(api.movementCodes.listMovementAliases);
  const seedMovementCodes = useMutation(api.movementCodes.seedMovementCodes);
  const upsertCode = useMutation(api.movementCodes.upsertMovementCode);
  const deleteCode = useMutation(api.movementCodes.deleteMovementCode);
  const upsertAlias = useMutation(api.movementCodes.upsertMovementAlias);
  const deleteAlias = useMutation(api.movementCodes.deleteMovementAlias);

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
    <div className="p-6 md:p-8" suppressHydrationWarning>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-space-grotesk gradient-text-emerald">
            Gestión de datos
          </h1>
          <p className="text-muted-foreground mt-1">
            Configuración de códigos de movimiento y aliases. Ejecuta cargas en{" "}
            <Link
              href="/configuracion/carga-fuentes"
              className="text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1"
            >
              <CloudDownload className="size-4" />
              Carga de fuentes
            </Link>
            {" "}y agregaciones en{" "}
            <Link
              href="/configuracion/enriquecimiento-agregaciones"
              className="text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1"
            >
              <Layers className="size-4" />
              Enriquecimiento y agregaciones
            </Link>
            .
          </p>
        </div>

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

    </div>
  );
}
