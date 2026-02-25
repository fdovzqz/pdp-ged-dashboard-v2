"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, Eye, Loader2, ShieldCheck } from "lucide-react";

export default function RulesCatalogPage(): React.ReactElement {
  const ruleSets = useQuery(api.ruleSets.listRuleSets, { limit: 100 });
  const ensureRuleSets = useMutation(api.ruleSets.ensureRuleSetsForImport);
  const [ensuring, setEnsuring] = useState(false);
  const [ensureResult, setEnsureResult] = useState<{ created: string[] } | null>(null);
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<Id<"ruleSets"> | null>(null);
  const ruleSetDetail = useQuery(
    api.ruleSets.getRuleSet,
    detailId ? { id: detailId } : "skip"
  );

  const handleEnsureRuleSets = async (): Promise<void> => {
    setEnsuring(true);
    setEnsureResult(null);
    setEnsureError(null);
    try {
      const result = await ensureRuleSets({});
      setEnsureResult(result);
    } catch (err) {
      setEnsureError(err instanceof Error ? err.message : String(err));
      console.error("ensureRuleSetsForImport:", err);
    } finally {
      setEnsuring(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Rules Catalog</h1>
      <p className="text-sm text-slate-400">
        Catálogo de RuleSets versionados (dedup, reconciliation, enrichment). Los rule sets se
        gestionan vía Convex Dashboard o con la mutation{" "}
        <code className="text-sky-400">ruleSets.insertRuleSet</code>.
      </p>

      <section className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-2">
        <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          <ShieldCheck className="size-4" />
          Reglas para importación CloudWatch + Datamapping
        </h2>
        <p className="text-xs text-slate-400">
          Crea las reglas necesarias para la migración completa (mensual, por periodo, por día o desde
          fecha): dedup, reconciliation, clean (normalización), enrichment (datamapping) y quality.
          Solo se insertan las que falten.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleEnsureRuleSets}
          disabled={ensuring}
          className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
        >
          {ensuring ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Comprobando…
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4" />
              Asegurar reglas para importación
            </>
          )}
        </Button>
        {ensureResult && (
          <div
            className={
              ensureResult.created.length > 0
                ? "rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400"
                : "rounded-lg bg-slate-500/10 border border-slate-500/30 p-3 text-sm text-slate-400"
            }
          >
            {ensureResult.created.length > 0 ? (
              <p>
                Creadas: <span className="font-mono">{ensureResult.created.join(", ")}</span>
              </p>
            ) : (
              <p>No faltaba ninguna; todas las reglas para importación ya existían.</p>
            )}
          </div>
        )}
        {ensureError && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            {ensureError}
          </div>
        )}
      </section>

      {ruleSets === undefined ? (
        <p className="text-slate-500 text-sm">Cargando reglas…</p>
      ) : ruleSets.length === 0 ? (
        <p className="text-slate-500 text-sm">
          No hay rule sets registrados. Inserta uno con <code className="text-sky-400">ruleSets.insertRuleSet</code> para
          dedup (cloudwatch), reconciliation o enrichment.
        </p>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full text-sm text-left text-slate-300">
            <thead className="text-slate-400 bg-slate-800/80">
              <tr>
                <th className="px-4 py-3 font-medium">Dominio</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Rule set / Versión</th>
                <th className="px-4 py-3 font-medium">Activation</th>
                <th className="px-4 py-3 font-medium">Reglas (tipos)</th>
                <th className="px-4 py-3 font-medium">Creado</th>
                <th className="px-4 py-3 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody>
              {ruleSets.map((rs) => (
                <tr key={rs._id} className="border-t border-slate-700 hover:bg-slate-800/50">
                  <td className="px-4 py-2">{rs.domain}</td>
                  <td className="px-4 py-2">{rs.sourceKey ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-sky-400">{rs.ruleSetKey}</span>
                    <span className="text-slate-500 ml-1">v{rs.version}</span>
                  </td>
                  <td className="px-4 py-2">{rs.activationPolicy}</td>
                  <td className="px-4 py-2">
                    {rs.rulesSummary.length > 0 ? (
                      <span className="font-mono text-amber-400/90">
                        {rs.rulesSummary.join(", ")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {new Date(rs.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetailId(rs._id)}
                      className="gap-1.5 text-slate-400 hover:text-sky-400"
                    >
                      <Eye className="size-3.5" />
                      Ver detalle
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="glass-card-elevated border-border/50 max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-slate-100">
              Detalle de regla
              {ruleSetDetail ? (
                <span className="font-mono text-sky-400 ml-2">
                  {ruleSetDetail.ruleSetKey} v{ruleSetDetail.version}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {ruleSetDetail === undefined ? (
            <p className="text-slate-500 text-sm py-4">Cargando…</p>
          ) : ruleSetDetail === null ? (
            <p className="text-slate-500 text-sm py-4">Regla no encontrada.</p>
          ) : (
            <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
              <section>
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                  Metadata
                </h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-slate-300">
                  <dt className="text-slate-500">Dominio</dt>
                  <dd className="font-mono">{ruleSetDetail.domain}</dd>
                  <dt className="text-slate-500">Source</dt>
                  <dd className="font-mono">{ruleSetDetail.sourceKey ?? "—"}</dd>
                  <dt className="text-slate-500">Activation</dt>
                  <dd className="font-mono">{ruleSetDetail.activationPolicy}</dd>
                  <dt className="text-slate-500">Creado</dt>
                  <dd>
                    {new Date(ruleSetDetail.createdAt).toLocaleString()}
                    {ruleSetDetail.createdBy ? (
                      <span className="text-slate-500 ml-1">por {ruleSetDetail.createdBy}</span>
                    ) : null}
                  </dd>
                </dl>
              </section>
              <section>
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                  Reglas (JSON)
                </h3>
                {Array.isArray(ruleSetDetail.rules) && ruleSetDetail.rules.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">
                    Sin reglas definidas (placeholder para uso futuro del engine).
                  </p>
                ) : (
                  <pre className="rounded-lg bg-slate-900/80 border border-slate-700 p-3 text-xs text-slate-300 overflow-auto max-h-60 font-mono whitespace-pre-wrap break-words">
                    {JSON.stringify(ruleSetDetail.rules, null, 2)}
                  </pre>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
