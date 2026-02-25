"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { StatusChip } from "@/components/ops/StatusChip";

export default function RunDetailPage(): React.ReactElement {
  const params = useParams();
  const jobId = params.id as Id<"pipelineJobs">;
  const job = useQuery(api.pipelineQueries.getPipelineJob, { jobId });
  const units = useQuery(api.pipelineQueries.getPipelineJobUnitsByJobId, { jobId });
  const events = useQuery(api.pipelineQueries.getAuditEventsForJob, { jobId });
  const retryFailed = useMutation(api.pipelineMutations.retryFailedUnits);
  const cancelJob = useMutation(api.pipelineMutations.cancelPipelineJob);

  if (job === undefined) return <p className="text-slate-400">Cargando...</p>;
  if (job === null) return <p className="text-red-400">Job no encontrado.</p>;

  const failed = units?.filter((u) => u.status === "failed") ?? [];
  const completedUnits = units?.filter((u) => u.status === "completed") ?? [];
  const runningUnits = units?.filter((u) => u.status === "running") ?? [];
  const pendingUnits = units?.filter((u) => u.status === "pending") ?? [];
  const totalUnits = units?.length ?? 0;
  const unitResultByUnitId = new Map(
    completedUnits.map((u) => [u.unitId, u.result as Record<string, unknown> | undefined])
  );
  const totals = completedUnits.reduce(
    (acc, u) => {
      const r = u.result as Record<string, unknown> | undefined;
      if (r && typeof r.inserted === "number") acc.inserted += r.inserted;
      if (r && typeof r.updated === "number") acc.updated += r.updated;
      if (r && typeof r.deleted === "number") acc.deleted += r.deleted;
      if (r && typeof r.processed === "number") acc.processed += r.processed;
      return acc;
    },
    { inserted: 0, updated: 0, deleted: 0, processed: 0 }
  );
  const hasAnyCounts =
    totals.inserted > 0 || totals.updated > 0 || totals.deleted > 0 || totals.processed > 0;
  const hasCloudwatchAudit =
    job.jobType === "cloudwatch_sync_by_range" &&
    completedUnits.some((u) => {
      const r = u.result as Record<string, unknown> | undefined;
      return r && typeof r === "object" && r.rawBySource != null;
    });
  const resultFailedDays =
    job.result && typeof job.result === "object" && "failedDays" in job.result
      ? (job.result as { failedDays: { date: string; error: string }[] }).failedDays
      : null;
  const hasFailedDays = Array.isArray(resultFailedDays) && resultFailedDays.length > 0;
  const showErrorSection = job.errorMessage || hasFailedDays;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-100">Run: {job.jobType}</h1>
        <div className="flex items-center gap-3">
          {job.status === "running" && (
            <button
              type="button"
              onClick={() => cancelJob({ jobId })}
              className="rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 px-3 py-2 text-sm hover:bg-red-500/30"
            >
              Cancelar job
            </button>
          )}
          <StatusChip status={job.status} />
        </div>
      </div>
      <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Scope</h2>
        <pre className="text-xs text-slate-300 overflow-auto max-h-40">
          {JSON.stringify(job.scope, null, 2)}
        </pre>
      </section>
      <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Progreso</h2>
        <p className="text-slate-300">
          {job.progress?.current ?? 0} / {(job.progress?.total ?? totalUnits) ?? "?"} unidades completadas
          {runningUnits.length > 0 && (
            <span className="ml-2 text-sky-400">
              · {runningUnits.length} en progreso
            </span>
          )}
          {pendingUnits.length > 0 && job.status === "running" && (
            <span className="ml-2 text-slate-500">
              · {pendingUnits.length} pendientes
            </span>
          )}
        </p>
        <p className="text-slate-500 text-xs mt-1">
          En jobs por mes (ej. enriquecimiento), cada unidad puede tardar varios minutos; el total se actualiza al terminar cada unidad.
        </p>
      </section>
      {job.jobType === "datamapping_enrichment_by_months" &&
        job.status === "completed" &&
        job.result != null &&
        typeof job.result === "object" &&
        "totalProcessed" in job.result &&
        (job.result as { totalProcessed: number; totalEnriched: number }).totalProcessed === 0 &&
        (job.result as { totalEnriched: number }).totalEnriched === 0 && (
        <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-sm text-emerald-400">
            Todo estaba ya enriquecido: no había registros con <code className="text-xs bg-slate-800/50 px-1 rounded">enrichmentExtracted = false</code> en el rango. Ver{" "}
            <Link href="/configuracion/carga-fuentes" className="underline">Carga de fuentes</Link>
            {" → \"Calcular pendientes\" o documentación en "}
            <code className="text-xs">docs/enriquecimiento-datamapping.md</code>.
          </p>
        </section>
      )}
      {showErrorSection && (
        <section className="rounded-lg border border-red-500/40 bg-red-500/10 p-4">
          <h2 className="text-sm font-medium text-red-400 mb-2">Error</h2>
          {job.errorMessage && <p className="text-sm text-slate-300 mb-3">{job.errorMessage}</p>}
          {hasFailedDays && resultFailedDays && (
            <div className="mt-2">
              <p className="text-xs text-slate-400 mb-1">Detalle por día:</p>
              <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
                {resultFailedDays.map((fd) => (
                  <li key={fd.date}>
                    <span className="font-mono text-amber-400/90">{fd.date}</span>
                    {fd.error
                      ? ` — ${fd.error}`
                      : " — Sin mensaje (posible timeout ~5 min). Revisar logs de Convex."}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {failed.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-400 mb-2">Unidades fallidas</h2>
          <button
            type="button"
            onClick={() => retryFailed({ jobId })}
            className="rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 px-3 py-2 text-sm"
          >
            Reintentar todas ({failed.length})
          </button>
          <ul className="mt-2 space-y-2 text-sm text-slate-400">
            {failed.map((u) => {
              const r = u.result as Record<string, unknown> | undefined;
              const hasDiagnostic = r && (r.durationMs != null || r.batchCount != null || r.chunkCount != null || r.inserted != null || r.updated != null);
              return (
                <li key={u.unitId}>
                  <span className="font-mono text-amber-400/90">{u.unitId}</span>
                  {!r?.error && (
                    <span className="ml-1 text-xs text-amber-400/80">
                      (posible timeout ~5 min — ver logs Convex)
                    </span>
                  )}
                  {hasDiagnostic && r && (
                    <pre className="mt-1 text-xs text-slate-500 bg-slate-900/50 rounded p-2 overflow-auto max-w-2xl">
                      {JSON.stringify(
                        {
                          error: r.error ?? "(sin mensaje)",
                          durationMs: r.durationMs,
                          batchCount: r.batchCount,
                          chunkCount: r.chunkCount,
                          inserted: r.inserted,
                          updated: r.updated,
                        },
                        null,
                        2
                      )}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {hasAnyCounts && (
        <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-2">Registros procesados</h2>
          <p className="text-slate-500 text-xs mb-3">
            Por día/unidad y total — insertados, actualizados y eliminados según el tipo de job.
          </p>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            {totals.inserted > 0 && (
              <span className="text-emerald-400">Total insertados: {totals.inserted.toLocaleString()}</span>
            )}
            {totals.updated > 0 && (
              <span className="text-sky-400">Total actualizados: {totals.updated.toLocaleString()}</span>
            )}
            {totals.deleted > 0 && (
              <span className="text-amber-400">Total eliminados: {totals.deleted.toLocaleString()}</span>
            )}
            {totals.processed > 0 && (
              <span className="text-violet-400">Total procesados: {totals.processed.toLocaleString()}</span>
            )}
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs text-left text-slate-400">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="py-1.5 pr-2 font-medium text-slate-300">Día / Unidad</th>
                  {totals.inserted > 0 && <th className="py-1.5 pr-2 font-medium text-slate-300 text-right">Insertados</th>}
                  {totals.updated > 0 && <th className="py-1.5 pr-2 font-medium text-slate-300 text-right">Actualizados</th>}
                  {totals.deleted > 0 && <th className="py-1.5 pr-2 font-medium text-slate-300 text-right">Eliminados</th>}
                  {totals.processed > 0 && totals.inserted === 0 && (
                    <th className="py-1.5 pr-2 font-medium text-slate-300 text-right">Procesados</th>
                  )}
                  {hasCloudwatchAudit && (
                    <>
                      <th className="py-1.5 pr-2 font-medium text-slate-300 text-right" title="Raw CloudWatch v1">Raw v1</th>
                      <th className="py-1.5 pr-2 font-medium text-slate-300 text-right" title="Raw CloudWatch v2">Raw v2</th>
                      <th className="py-1.5 pr-2 font-medium text-slate-300 text-right" title="Raw CloudWatch payment">Raw pay</th>
                      <th className="py-1.5 pr-2 font-medium text-slate-300 text-right" title="Parseados v1">Parsed v1</th>
                      <th className="py-1.5 pr-2 font-medium text-slate-300 text-right" title="Parseados v2">Parsed v2</th>
                      <th className="py-1.5 pr-2 font-medium text-slate-300 text-right" title="Parseados payment">Parsed pay</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...completedUnits]
                  .sort((a, b) => a.unitId.localeCompare(b.unitId))
                  .map((u) => {
                    const r = u.result as Record<string, unknown> | undefined;
                    const ins = r && typeof r.inserted === "number" ? r.inserted : 0;
                    const upd = r && typeof r.updated === "number" ? r.updated : 0;
                    const del = r && typeof r.deleted === "number" ? r.deleted : 0;
                    const proc = r && typeof r.processed === "number" ? r.processed : 0;
                    const raw = r && typeof r.rawBySource === "object" && r.rawBySource != null ? (r.rawBySource as { v1: number; v2: number; payment: number }) : null;
                    const parsed = r && typeof r.parsedBySource === "object" && r.parsedBySource != null ? (r.parsedBySource as { v1: number; v2: number; payment: number }) : null;
                    const hasRow = ins > 0 || upd > 0 || del > 0 || proc > 0 || raw != null;
                    if (!hasRow) return null;
                    return (
                      <tr key={u.unitId} className="border-b border-slate-700/50">
                        <td className="py-1 pr-2 font-mono text-slate-300">{u.unitId}</td>
                        {totals.inserted > 0 && (
                          <td className="py-1 pr-2 text-right">{ins.toLocaleString()}</td>
                        )}
                        {totals.updated > 0 && (
                          <td className="py-1 pr-2 text-right">{upd.toLocaleString()}</td>
                        )}
                        {totals.deleted > 0 && (
                          <td className="py-1 pr-2 text-right">{del.toLocaleString()}</td>
                        )}
                        {totals.processed > 0 && totals.inserted === 0 && (
                          <td className="py-1 pr-2 text-right">{proc.toLocaleString()}</td>
                        )}
                        {hasCloudwatchAudit && (
                          <>
                            <td className="py-1 pr-2 text-right text-slate-400">{raw?.v1 != null ? raw.v1.toLocaleString() : "—"}</td>
                            <td className="py-1 pr-2 text-right text-slate-400">{raw?.v2 != null ? raw.v2.toLocaleString() : "—"}</td>
                            <td className="py-1 pr-2 text-right text-slate-400">{raw?.payment != null ? raw.payment.toLocaleString() : "—"}</td>
                            <td className="py-1 pr-2 text-right text-slate-500">{parsed?.v1 != null ? parsed.v1.toLocaleString() : "—"}</td>
                            <td className="py-1 pr-2 text-right text-slate-500">{parsed?.v2 != null ? parsed.v2.toLocaleString() : "—"}</td>
                            <td className="py-1 pr-2 text-right text-slate-500">{parsed?.payment != null ? parsed.payment.toLocaleString() : "—"}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {job.jobType === "datamapping_load_from_date" &&
        job.result &&
        typeof job.result === "object" &&
        "byDate" in job.result &&
        typeof (job.result as { byDate?: Record<string, number> }).byDate === "object" &&
        Object.keys((job.result as { byDate: Record<string, number> }).byDate).length > 0 && (
        <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-2">Registros por día</h2>
          <p className="text-slate-500 text-xs mb-3">
            Desglose por fecha (updatedAt) — carga desde fecha.
          </p>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs text-left text-slate-400">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className="py-1.5 pr-2 font-medium text-slate-300">Día</th>
                  <th className="py-1.5 pr-2 font-medium text-slate-300 text-right">Registros</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries((job.result as { byDate: Record<string, number> }).byDate)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, count]) => (
                    <tr key={date} className="border-b border-slate-700/50">
                      <td className="py-1 pr-2 font-mono text-slate-300">{date}</td>
                      <td className="py-1 pr-2 text-right">{count.toLocaleString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Unidades completadas</h2>
        <p className="text-slate-500 text-xs mb-2">
          Días (o unidades) que ya corrieron — útil si el job se canceló o falló a mitad.
        </p>
        {runningUnits.length > 0 && (
          <div className="mb-4">
            <p className="text-sky-400 text-xs font-medium mb-1">En curso:</p>
            <ul className="space-y-1 text-xs text-slate-300">
              {runningUnits.map((u) => {
                const detail = u.progressDetail as
                  | { processed: number; enriched?: number; updated?: number }
                  | undefined;
                return (
                  <li key={u.unitId}>
                    <span className="font-mono text-slate-200">{u.unitId}</span>
                    {detail != null ? (
                      <span className="ml-2 text-sky-400/90">
                        — {detail.processed.toLocaleString()} procesados
                        {detail.enriched != null && (
                          <>, {detail.enriched.toLocaleString()} enriquecidos</>
                        )}
                        {detail.updated != null && (
                          <>, {detail.updated.toLocaleString()} actualizados</>
                        )}
                      </span>
                    ) : (
                      <span className="ml-2 text-slate-500">— iniciando…</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {(() => {
          const completed = units?.filter((u) => u.status === "completed") ?? [];
          const pending = units?.filter((u) => u.status === "pending") ?? [];
          if (completed.length === 0 && pending.length === 0) {
            return <p className="text-slate-500 text-xs">Sin unidades aún o sin datos.</p>;
          }
          const completedIds = completed.map((u) => u.unitId).sort();
          const pendingIds = pending.map((u) => u.unitId).sort();
          const formatList = (list: string[], maxVisible: number) =>
            list.length <= maxVisible
              ? list.join("\n")
              : `${list.slice(0, maxVisible / 2).join("\n")}\n... (${list.length - maxVisible} más) ...\n${list.slice(-maxVisible / 2).join("\n")}`;
          return (
            <div className="space-y-4">
              <p className="text-slate-300 text-sm">
                <span className="text-emerald-400">{completedIds.length}</span> completadas
                {pendingIds.length > 0 && (
                  <>
                    {" "}
                    · <span className="text-amber-400">{pendingIds.length}</span> pendientes (no corrieron)
                  </>
                )}
              </p>
              <div>
                <p className="text-slate-500 text-xs mb-1">Días/unidades que sí corrieron:</p>
                <pre className="text-xs text-slate-400 overflow-auto max-h-40 bg-slate-900/50 rounded p-2 font-mono">
                  {formatList(completedIds, 100)}
                </pre>
              </div>
              {pendingIds.length > 0 && (
                <div>
                  <p className="text-slate-500 text-xs mb-1">Días/unidades que no corrieron (pendientes):</p>
                  <pre className="text-xs text-amber-400/90 overflow-auto max-h-40 bg-slate-900/50 rounded p-2 font-mono">
                    {formatList(pendingIds, 100)}
                  </pre>
                </div>
              )}
            </div>
          );
        })()}
      </section>
      <section className="rounded-lg border border-slate-700 p-4">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Auditoría</h2>
        <ul className="space-y-2 text-xs text-slate-400">
          {(events ?? []).map((e) => {
            const result = e.unitKey != null ? unitResultByUnitId.get(e.unitKey) : undefined;
            const summary = e.resultSummary as { diagnostic?: { durationMs?: number; batchCount?: number; inserted?: number; updated?: number; error?: string } } | undefined;
            const diagnostic = summary?.diagnostic;
            const countParts: string[] = [];
            if (result && typeof result.inserted === "number") countParts.push(`${result.inserted} ins`);
            if (result && typeof result.updated === "number") countParts.push(`${result.updated} upd`);
            if (result && typeof result.deleted === "number") countParts.push(`${result.deleted} del`);
            if (result && typeof result.processed === "number") countParts.push(`${result.processed} proc`);
            if (diagnostic?.inserted != null) countParts.push(`${diagnostic.inserted} ins`);
            if (diagnostic?.updated != null) countParts.push(`${diagnostic.updated} upd`);
            const countStr = countParts.length > 0 ? ` — ${countParts.join(", ")}` : "";
            return (
              <li key={e._id} className={e.eventType === "unit.failed" ? "text-amber-400/90" : ""}>
                {e.eventType}
                {e.unitKey != null && e.unitKey !== "" ? ` — ${e.unitKey}` : ""}
                {countStr}
                {diagnostic != null && (diagnostic.durationMs != null || diagnostic.batchCount != null || diagnostic.error != null) && (
                  <span className="block mt-0.5 text-slate-500">
                    {diagnostic.durationMs != null && `durationMs: ${diagnostic.durationMs}`}
                    {diagnostic.batchCount != null && ` · batchCount: ${diagnostic.batchCount}`}
                    {diagnostic.error != null && ` · error: ${diagnostic.error}`}
                  </span>
                )}
                {" — "}
                {new Date(e.timestamp).toISOString()}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
