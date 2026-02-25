"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useConvex } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
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
import { RefreshCw, Activity } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { formatErrorMessage } from "@/lib/formatErrorMessage";

export default function StatusActualizacionesPage(): React.ReactElement {
  const [pipelineJobsRefresh, setPipelineJobsRefresh] = useState(0);
  const [pipelineJobsCursor, setPipelineJobsCursor] = useState<string | null>(
    null
  );
  const [selectedJobId, setSelectedJobId] = useState<Id<"pipelineJobs"> | null>(
    null
  );
  const [datamappingWatermark, setDatamappingWatermark] = useState<{
    lastUpdatedAt: string | null;
  } | undefined>(undefined);

  const convex = useConvex();
  useEffect(() => {
    let cancelled = false;
    convex.query(api.datamappingQueries.getDatamappingWatermark).then((value) => {
      if (!cancelled) setDatamappingWatermark(value);
    });
    return () => {
      cancelled = true;
    };
  }, [convex]);

  const pipelineJobsResult = useQuery(
    api.pipelineQueries.listPipelineJobs,
    {
      paginationOpts: {
        numItems: 50,
        cursor: pipelineJobsCursor ?? null,
      },
      _refresh: pipelineJobsRefresh,
    }
  );
  const selectedPipelineJob = useQuery(
    api.pipelineQueries.getPipelineJob,
    selectedJobId ? { jobId: selectedJobId } : "skip"
  );

  const pipelineJobs =
    pipelineJobsResult?.page ?? ([] as Doc<"pipelineJobs">[]);
  const pipelineJobsIsDone = pipelineJobsResult?.isDone ?? true;
  const pipelineJobsContinueCursor = pipelineJobsResult?.continueCursor ?? null;

  return (
    <div className="p-6 md:p-8" suppressHydrationWarning>
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-space-grotesk gradient-text-emerald flex items-center gap-2">
            <Activity className="size-8" />
            Status de actualizaciones
          </h1>
          <p className="text-muted-foreground mt-1">
            Estado de jobs de Inngest y acciones async. Marca de agua de
            datamapping para extracción incremental.
          </p>
        </div>

        {/* Marca de agua datamapping */}
        <div className="glass-card rounded-xl p-6 space-y-2">
          <h2 className="text-lg font-semibold">Marca de agua (DataMapping)</h2>
          <p className="text-sm text-muted-foreground">
            Último <code className="text-xs bg-slate-800/50 px-1 rounded">updatedAt</code> procesado en
            extracción incremental. Los jobs de Carga de fuentes la actualizan.
          </p>
          {datamappingWatermark?.lastUpdatedAt ? (
            <p className="text-sm text-emerald-400 font-mono">
              Marca actual: {datamappingWatermark.lastUpdatedAt}
            </p>
          ) : (
            <p className="text-sm text-amber-400/90">
              No hay marca de agua. Ejecutar primero histórico completo o Cargar
              desde fecha en{" "}
              <Link
                href="/configuracion/carga-fuentes"
                className="text-emerald-400 hover:text-emerald-300"
              >
                Carga de fuentes
              </Link>
              .
            </p>
          )}
        </div>

        {/* Pipeline Jobs */}
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
      </div>

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
                      (Array.isArray(r.completedMonths) &&
                        Array.isArray(r.failedMonths));
                    return (
                      <>
                        {hasSummary && (
                          <div className="bg-slate-800/50 p-3 rounded mt-1 space-y-1.5 text-xs">
                            {typeof r.summary === "string" && (
                              <p className="font-medium text-emerald-400">
                                {r.summary}
                              </p>
                            )}
                            {typeof r.totalInserted === "number" &&
                              typeof r.totalUpdated === "number" && (
                                <p>
                                  Total: {r.totalInserted} insertados,{" "}
                                  {r.totalUpdated} actualizados
                                </p>
                              )}
                            {Array.isArray(r.completedMonths) &&
                              r.completedMonths.length > 0 && (
                                <p>
                                  Meses ok: {r.completedMonths.length} (
                                  {String(r.completedMonths[0])}
                                  {r.completedMonths.length > 1
                                    ? " … " +
                                      String(
                                        r.completedMonths[
                                          r.completedMonths.length - 1
                                        ]
                                      )
                                    : ""}
                                  )
                                </p>
                              )}
                            {Array.isArray(r.failedMonths) &&
                              r.failedMonths.length > 0 && (
                                <div className="text-destructive">
                                  <p className="font-medium">
                                    Meses fallidos ({r.failedMonths.length}):
                                  </p>
                                  <ul className="list-disc list-inside mt-0.5">
                                    {(
                                      r.failedMonths as Array<{
                                        ym?: string;
                                        error?: string;
                                      }>
                                    ).map((f, i) => (
                                      <li key={i}>
                                        {f.ym ?? String(f)}:{" "}
                                        {(f as { error?: string }).error ?? ""}
                                      </li>
                                    ))}
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
