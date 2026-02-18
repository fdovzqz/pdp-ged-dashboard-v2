"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAction, useQuery, useConvex } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLink,
  GitCompare,
  Loader2,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  FileWarning,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { timestampToMexicoMonth } from "@/lib/mexicoDateRange";

type ErrorKind = "onlyCw" | "onlyDdb" | "mismatch" | "monthMismatch";

const KIND_LABELS: Record<ErrorKind, string> = {
  onlyCw: "Solo en CloudWatch",
  onlyDdb: "Solo en Datamapping",
  mismatch: "En ambos (monto distinto)",
  monthMismatch: "En ambos (mes distinto)",
};

function buildCsv(
  kind: ErrorKind,
  rows: Doc<"reconciliationErrors">[],
  options?: {
    paymentMonthsByRef?: Record<string, string>;
    datamappingMonthsByRef?: Record<string, string>;
  }
): string {
  const baseHeader = "referencia,enPaymentRecords,mesCw,enDatamapping,mesDdb,";
  const header =
    kind === "mismatch"
      ? baseHeader + "logSource,montoCloudWatch,montoDynamoDB\n"
      : kind === "onlyCw"
        ? baseHeader + "monto,logSource\n"
        : kind === "monthMismatch"
          ? baseHeader + "monto,logSource\n"
          : baseHeader + "monto\n";
  const cell = (v: string | undefined | null) =>
    v != null && v !== "" ? v : "—";
  const body = rows
    .map((r) => {
      const effectiveCwMonth =
        options?.paymentMonthsByRef?.[r.referencia] ??
        (r.importMonth != null && r.importMonth !== "" ? r.importMonth : null);
      const enCw = effectiveCwMonth ? "Sí" : "—";
      const mesCw = cell(effectiveCwMonth);
      const effectiveDdbMonth =
        options?.datamappingMonthsByRef?.[r.referencia] ??
        (r.datamappingUpdatedAt
          ? timestampToMexicoMonth(r.datamappingUpdatedAt)
          : null);
      const enDdb = effectiveDdbMonth ? "Sí" : "—";
      const mesDdb = cell(effectiveDdbMonth);
      const base = `${escapeCsv(r.referencia)},${enCw},${mesCw},${enDdb},${mesDdb}`;
      if (kind === "mismatch") {
        return `${base},${escapeCsv(r.logSource ?? "")},${r.montoCloudWatch ?? ""},${r.montoDynamoDB ?? ""}`;
      }
      if (kind === "onlyCw" || kind === "monthMismatch") {
        return `${base},${r.monto ?? ""},${escapeCsv(r.logSource ?? "")}`;
      }
      return `${base},${r.monto ?? ""}`;
    })
    .join("\n");
  return "\uFEFF" + header + body;
}

function escapeCsv(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type ScopeType = "universe" | "month" | "period";

const MONTH_NAMES: Record<string, string> = {
  "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Ago", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic",
};

function formatScopeLabel(scopeId: string): string {
  if (scopeId === "universe") return "Todo el universo";
  if (scopeId.includes("::")) {
    const [s, e] = scopeId.split("::");
    const [, sm] = s.split("-");
    const [ey, em] = e.split("-");
    return `${MONTH_NAMES[sm] ?? sm} ${s.slice(0, 4)} - ${MONTH_NAMES[em] ?? em} ${ey}`;
  }
  const [, m] = scopeId.split("-");
  return `${MONTH_NAMES[m] ?? m} ${scopeId.slice(0, 4)}`;
}

export default function ReconcileJanuary2026Page(): React.ReactElement {
  const convex = useConvex();
  const runReconciliationAction = useAction(api.actions.runReconciliation);
  const summary = useQuery(api.queries.getReconciliationSummaryJanuary2026);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<ErrorKind | null>(null);
  const [csvLoading, setCsvLoading] = useState<ErrorKind | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [scope, setScope] = useState<ScopeType>("month");
  const [month, setMonth] = useState("2026-01");
  const [startMonth, setStartMonth] = useState("2026-01");
  const [endMonth, setEndMonth] = useState("2026-01");

  const effectiveSummary =
    summary ??
    (result != null &&
    typeof result === "object" &&
    "summary" in result
      ? (result as { summary: typeof summary }).summary
      : null);

  const downloadCsv = useCallback(
    async (kind: ErrorKind) => {
      setCsvLoading(kind);
      try {
        let cursor: string | null = null;
        const all: Doc<"reconciliationErrors">[] = [];
        let res: { page: Doc<"reconciliationErrors">[]; isDone: boolean; continueCursor: string | null };
        do {
          res = await convex.query(
            api.queries.getReconciliationErrorsPage,
            { kind, cursor, numItems: 2000 }
          );
          all.push(...res.page);
          cursor = res.continueCursor;
        } while (!res.isDone);
        const opts: {
          paymentMonthsByRef?: Record<string, string>;
          datamappingMonthsByRef?: Record<string, string>;
        } = {};
        const CHUNK = 300;
        if (kind === "onlyDdb" && all.length > 0) {
          opts.paymentMonthsByRef = {};
          for (let i = 0; i < all.length; i += CHUNK) {
            const chunk = all.slice(i, i + CHUNK).map((r) => r.referencia);
            const part = await convex.query(
              api.queries.getPaymentRecordsMonthsForReferencias,
              { referencias: chunk }
            );
            Object.assign(opts.paymentMonthsByRef, part);
          }
        }
        if (kind === "onlyCw" && all.length > 0) {
          opts.datamappingMonthsByRef = {};
          for (let i = 0; i < all.length; i += CHUNK) {
            const chunk = all.slice(i, i + CHUNK).map((r) => r.referencia);
            const part = await convex.query(
              api.queries.getDatamappingMonthsForReferencias,
              { referencias: chunk }
            );
            Object.assign(opts.datamappingMonthsByRef, part);
          }
        }
        const csv = buildCsv(kind, all, opts);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const scopeSlug = effectiveSummary?.month ?? "run";
        a.href = url;
        a.download = `reconciliacion-${scopeSlug.replace("::", "_")}-${kind}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        setCsvLoading(null);
      }
    },
    [convex, effectiveSummary?.month]
  );

  const totalRefs =
    effectiveSummary != null
      ? effectiveSummary.matchCount +
        (effectiveSummary.monthMismatchCount ?? 0) +
        effectiveSummary.onlyCwCount +
        effectiveSummary.onlyDdbCount +
        effectiveSummary.mismatchCount
      : 0;

  const hasExistingResult = effectiveSummary != null || result != null;

  const handleRunWithResult = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setSelectedKind(null);
    try {
      const args =
        scope === "universe"
          ? { scope: "universe" as const }
          : scope === "month"
            ? { scope: "month" as const, month }
            : {
                scope: "period" as const,
                startMonth,
                endMonth,
              };
      const data = await runReconciliationAction(args);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al calcular reconciliación");
    } finally {
      setLoading(false);
    }
  };

  const scopeLabel =
    effectiveSummary?.month != null ? formatScopeLabel(effectiveSummary.month) : null;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Reconciliación
              {scopeLabel != null ? `: ${scopeLabel}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Cruce en Convex: paymentRecords vs datamappingRecords. Elige todo el universo, un mes o un periodo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => window.open("/reconcile/january-2026", "_blank")}
            >
              <ExternalLink className="size-4" />
              Nueva ventana
            </Button>
            {hasExistingResult && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-2"
                onClick={handleRunWithResult}
                disabled={loading}
              >
                <RefreshCw className="size-4" />
                Recalcular
              </Button>
            )}
          </div>
        </div>

        {/* Form: siempre visible para calcular o cambiar alcance. Al ejecutar se borran los datos actuales. */}
        {!loading && (
          <Card className="border-slate-700/50 bg-slate-900/30">
            <CardHeader>
              <CardTitle className="text-base">
                {hasExistingResult ? "Ejecutar otra reconciliación" : "Calcular reconciliación"}
              </CardTitle>
              <CardDescription>
                {hasExistingResult
                  ? "Elige un nuevo alcance y pulsa Calcular. Los datos actuales se borrarán y se generará la nueva reconciliación."
                  : "Usa datos en Convex. Guarda resultados en tablas de errores. Puede tardar 1–2 min (periodo/universo más)."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Alcance</p>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === "universe"}
                      onChange={() => setScope("universe")}
                      className="rounded border-slate-500"
                    />
                    <span className="text-sm">Todo el universo</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === "month"}
                      onChange={() => setScope("month")}
                      className="rounded border-slate-500"
                    />
                    <span className="text-sm">Un mes</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === "period"}
                      onChange={() => setScope("period")}
                      className="rounded border-slate-500"
                    />
                    <span className="text-sm">Periodo a elegir</span>
                  </label>
                </div>
              </div>
              {scope === "month" && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm text-muted-foreground">Mes:</label>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
              )}
              {scope === "period" && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground">Desde:</label>
                    <input
                      type="month"
                      value={startMonth}
                      onChange={(e) => setStartMonth(e.target.value)}
                      className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-muted-foreground">Hasta:</label>
                    <input
                      type="month"
                      value={endMonth}
                      onChange={(e) => setEndMonth(e.target.value)}
                      className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                    />
                  </div>
                  {startMonth > endMonth && (
                    <span className="text-sm text-amber-500">Desde debe ser ≤ hasta</span>
                  )}
                </div>
              )}
              <Button
                onClick={handleRunWithResult}
                disabled={loading || (scope === "period" && startMonth > endMonth)}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Calculando…
                  </>
                ) : (
                  <>
                    <GitCompare className="size-4" />
                    {hasExistingResult ? "Calcular (reemplaza actual)" : "Calcular reconciliación"}
                    {scope === "universe"
                      ? " (todo el universo)"
                      : scope === "month"
                        ? ` (${formatScopeLabel(month)})`
                        : ` (${formatScopeLabel(`${startMonth}::${endMonth}`)})`}
                  </>
                )}
              </Button>
              {error != null && (
                <p className="mt-3 text-sm text-destructive">{error}</p>
              )}
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 text-center">
            <Loader2 className="size-8 animate-spin mx-auto text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Leyendo Convex y guardando errores…
            </p>
          </div>
        )}

        {/* Cuadros: éxito primero, luego problemas con % */}
        {effectiveSummary != null && !loading && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {/* Éxito */}
              <Card
                className={`cursor-pointer border-emerald-500/30 bg-emerald-500/5 transition-colors hover:bg-emerald-500/10 ${
                  selectedKind === null ? "ring-2 ring-emerald-400" : ""
                }`}
                onClick={() => setSelectedKind(null)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 className="size-5" />
                    <span className="text-sm font-medium">
                      En ambos (monto coincide)
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {effectiveSummary.matchCount.toLocaleString("es-MX")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totalRefs > 0
                      ? `${((effectiveSummary.matchCount / totalRefs) * 100).toFixed(1)}% del total`
                      : "—"}
                  </p>
                </CardContent>
              </Card>

              {/* En ambos (mes distinto) — verde ligero, no grave */}
              <Card
                className={`cursor-pointer border-green-400/30 bg-green-500/5 transition-colors hover:bg-green-500/10 ${
                  selectedKind === "monthMismatch" ? "ring-2 ring-green-400" : ""
                }`}
                onClick={() => setSelectedKind("monthMismatch")}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-green-400">
                    <GitCompare className="size-5" />
                    <span className="text-sm font-medium">
                      {KIND_LABELS.monthMismatch}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {(effectiveSummary.monthMismatchCount ?? 0).toLocaleString("es-MX")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totalRefs > 0
                      ? `${(((effectiveSummary.monthMismatchCount ?? 0) / totalRefs) * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </CardContent>
              </Card>

              {/* Solo CW */}
              <Card
                className={`cursor-pointer border-amber-500/30 bg-amber-500/5 transition-colors hover:bg-amber-500/10 ${
                  selectedKind === "onlyCw" ? "ring-2 ring-amber-400" : ""
                }`}
                onClick={() => setSelectedKind("onlyCw")}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-amber-400">
                    <AlertCircle className="size-5" />
                    <span className="text-sm font-medium">
                      {KIND_LABELS.onlyCw}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {effectiveSummary.onlyCwCount.toLocaleString("es-MX")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totalRefs > 0
                      ? `${((effectiveSummary.onlyCwCount / totalRefs) * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </CardContent>
              </Card>

              {/* Solo DDB — amarillo/naranja */}
              <Card
                className={`cursor-pointer border-orange-500/30 bg-orange-500/5 transition-colors hover:bg-orange-500/10 ${
                  selectedKind === "onlyDdb" ? "ring-2 ring-orange-400" : ""
                }`}
                onClick={() => setSelectedKind("onlyDdb")}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-orange-400">
                    <FileWarning className="size-5" />
                    <span className="text-sm font-medium">
                      {KIND_LABELS.onlyDdb}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {effectiveSummary.onlyDdbCount.toLocaleString("es-MX")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totalRefs > 0
                      ? `${((effectiveSummary.onlyDdbCount / totalRefs) * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </CardContent>
              </Card>

              {/* Mismatch */}
              <Card
                className={`cursor-pointer border-red-500/30 bg-red-500/5 transition-colors hover:bg-red-500/10 ${
                  selectedKind === "mismatch" ? "ring-2 ring-red-400" : ""
                }`}
                onClick={() => setSelectedKind("mismatch")}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle className="size-5" />
                    <span className="text-sm font-medium">
                      {KIND_LABELS.mismatch}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {effectiveSummary.mismatchCount.toLocaleString("es-MX")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {totalRefs > 0
                      ? `${((effectiveSummary.mismatchCount / totalRefs) * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Detalle + CSV solo al seleccionar un tipo de problema */}
            {selectedKind != null && (
              <ReconciliationErrorsDetail
                kind={selectedKind}
                onDownloadCsv={() => downloadCsv(selectedKind)}
                csvLoading={csvLoading === selectedKind}
              />
            )}
          </>
        )}

        {/* Siempre visible: investigar una referencia */}
        <InvestigateReferenciaCard />
      </div>
    </div>
  );
}

function InvestigateReferenciaCard(): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const investigation = useQuery(api.queries.investigateReferenciaReconciliation, {
    referencia: submittedRef ?? "",
  });

  return (
    <Card className="border-slate-700/50 bg-slate-900/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Investigar referencia</CardTitle>
        <CardDescription>
          Ver por qué una referencia aparece como solo CloudWatch, solo
          Datamapping o mismatch (ej. updatedAt fuera del periodo, precisión
          numérica).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Ej. 202600450796348666220"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSubmittedRef(inputValue.trim() || null);
            }}
            className="min-w-[200px] rounded border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSubmittedRef(inputValue.trim() || null)}
          >
            Investigar
          </Button>
        </div>
        {investigation !== undefined &&
          submittedRef !== null &&
          submittedRef !== "" && (
          <div className="rounded border border-slate-700/50 bg-slate-800/50 p-4 text-sm space-y-3">
            <p className="font-medium text-foreground">
              {investigation.conclusion}</p>
            {investigation.note != null && (
              <p className="text-muted-foreground text-xs">{investigation.note}</p>
            )}
            {investigation.paymentRecords.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">
                  paymentRecords ({investigation.paymentRecords.length})
                </p>
                <ul className="list-disc list-inside text-xs font-mono">
                  {investigation.paymentRecords.map((r, i) => (
                    <li key={i}>
                      ref={r.referencia} monto={r.monto} {r.logSource}{" "}
                      {r.importMonth} {r.importDate}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {investigation.datamappingRecords.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">
                  datamappingRecords ({investigation.datamappingRecords.length})
                </p>
                <ul className="list-disc list-inside text-xs font-mono">
                  {investigation.datamappingRecords.map((r, i) => (
                    <li key={i}>
                      ref={r.referencia} monto={r.monto} updatedAt={r.updatedAt}{" "}
                      {r.inJanuary2026 ? "✓ en periodo" : "✗ fuera periodo"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getRowMonth(r: Doc<"reconciliationErrors">): string {
  const raw =
    r.importMonth != null && String(r.importMonth).trim() !== ""
      ? String(r.importMonth).trim().substring(0, 7)
      : null;
  if (raw) return raw;
  if (
    r.datamappingUpdatedAt != null &&
    String(r.datamappingUpdatedAt).trim() !== ""
  ) {
    return timestampToMexicoMonth(r.datamappingUpdatedAt);
  }
  return "—";
}

function ReconciliationErrorsDetail({
  kind,
  onDownloadCsv,
  csvLoading,
}: {
  kind: ErrorKind;
  onDownloadCsv: () => void;
  csvLoading: boolean;
}): React.ReactElement {
  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulated, setAccumulated] = useState<Doc<"reconciliationErrors">[]>([]);
  const [countsByMonth, setCountsByMonth] = useState<Record<string, number> | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const autoLoadRequestedRef = useRef(false);
  const hadMonthFilterRef = useRef(false);
  const getCountsByMonth = useAction(api.actions.getReconciliationErrorsCountByMonth);
  const onlyCwWithPayment = useQuery(
    api.queries.getReconciliationErrorsOnlyCwWithPayment,
    kind === "onlyCw" ? {} : "skip"
  );
  const page = useQuery(api.queries.getReconciliationErrorsPage, {
    kind,
    cursor,
    numItems: 100,
  });
  const hasMonthFilter = selectedMonths.size > 0;
  const rawRows =
    page == null
      ? []
      : hasMonthFilter
        ? cursor === null
          ? page.page
          : accumulated
        : page.page;
  const filteredRows =
    !hasMonthFilter ? rawRows : rawRows.filter((r) => selectedMonths.has(getRowMonth(r)));
  const displayRows = filteredRows;

  const toggleMonth = (monthKey: string): void => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const clearMonthFilter = (): void => setSelectedMonths(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch conteos por tipo
    setCountsByMonth(null);
    setCountsLoading(true);
    getCountsByMonth({ kind })
      .then((r) => {
        setCountsByMonth(r.countsByMonth);
      })
      .finally(() => {
        setCountsLoading(false);
      });
  }, [kind, getCountsByMonth]);

  /** Convex limita argumentos (array max 8192). Enviamos solo un slice para no exceder. */
  const MAX_REFERENCIAS_QUERY = 3000;
  const referenciasForPaymentLookup =
    kind === "onlyDdb" && displayRows.length > 0
      ? displayRows.slice(0, MAX_REFERENCIAS_QUERY).map((r) => r.referencia)
      : [];
  const referenciasForDatamappingLookup =
    kind === "onlyCw" && displayRows.length > 0
      ? displayRows.slice(0, MAX_REFERENCIAS_QUERY).map((r) => r.referencia)
      : [];
  const paymentMonthsByRef = useQuery(
    api.queries.getPaymentRecordsMonthsForReferencias,
    referenciasForPaymentLookup.length > 0
      ? { referencias: referenciasForPaymentLookup }
      : "skip"
  );
  const datamappingMonthsByRef = useQuery(
    api.queries.getDatamappingMonthsForReferencias,
    referenciasForDatamappingLookup.length > 0
      ? { referencias: referenciasForDatamappingLookup }
      : "skip"
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset al cambiar tipo
    setCursor(null);
    setAccumulated([]);
    setSelectedMonths(new Set());
    autoLoadRequestedRef.current = false;
    hadMonthFilterRef.current = false;
  }, [kind]);

  // Al quitar el filtro: volver a primera página. Al activar filtro: empezar a acumular desde el inicio.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reset al entrar/salir de filtro por mes */
    if (!hasMonthFilter) {
      if (hadMonthFilterRef.current) {
        setCursor(null);
        setAccumulated([]);
      }
      hadMonthFilterRef.current = false;
      return;
    }
    if (!hadMonthFilterRef.current) {
      hadMonthFilterRef.current = true;
      setCursor(null);
      setAccumulated([]);
      autoLoadRequestedRef.current = false;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [hasMonthFilter]);

  useEffect(() => {
    if (page == null) return;
    /* eslint-disable react-hooks/set-state-in-effect -- sincronizar accumulated con Convex */
    if (!hasMonthFilter) {
      setAccumulated([]);
      return;
    }
    autoLoadRequestedRef.current = false;
    if (cursor === null) {
      setAccumulated(page.page);
    } else {
      setAccumulated((prev) => [...prev, ...page.page]);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [page, cursor, hasMonthFilter]);

  // Con filtro por mes activo y tabla vacía, cargar una página más (evitar varias seguidas = menos parpadeo)
  useEffect(() => {
    if (
      selectedMonths.size === 0 ||
      filteredRows.length > 0 ||
      !page ||
      page.isDone ||
      page.continueCursor == null ||
      autoLoadRequestedRef.current
    ) {
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- auto-carga al filtrar por mes */
    autoLoadRequestedRef.current = true;
    setCursor(page.continueCursor);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    selectedMonths.size,
    filteredRows.length,
    page?.isDone,
    page?.continueCursor,
  ]);

  if (page === undefined) {
    return (
      <Card className="border-slate-700/50">
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando…
        </CardContent>
      </Card>
    );
  }

  const hasMore = !page.isDone && page.continueCursor != null;

  return (
    <Card className="border-slate-700/50 bg-slate-900/30">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{KIND_LABELS[kind]}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onDownloadCsv}
            disabled={csvLoading}
          >
            {csvLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Descargar CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Problemas por mes */}
        {countsLoading ? (
          <p className="text-sm text-muted-foreground">Agrupando por mes…</p>
        ) : countsByMonth != null && Object.keys(countsByMonth).length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Problemas por mes — clic para filtrar la tabla (varios o ninguno = todos)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {selectedMonths.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={clearMonthFilter}
                >
                  Todos
                </Button>
              )}
              {Object.entries(countsByMonth)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([monthKey, count]) => {
                  const label =
                    monthKey === "—"
                      ? "Sin mes"
                      : (() => {
                          const [, m] = monthKey.split("-");
                          const name = MONTH_NAMES[m as keyof typeof MONTH_NAMES] ?? m;
                          return `${name} ${monthKey.slice(0, 4)}`;
                        })();
                  const isSelected = selectedMonths.has(monthKey);
                  return (
                    <Badge
                      key={monthKey}
                      variant={isSelected ? "default" : "secondary"}
                      className="font-mono text-xs px-2 py-1 cursor-pointer hover:opacity-90"
                      onClick={() => toggleMonth(monthKey)}
                    >
                      {label}: {count.toLocaleString("es-MX")}
                    </Badge>
                  );
                })}
            </div>
            {selectedMonths.size > 0 && (
              <p className="text-xs text-muted-foreground">
                Mostrando {filteredRows.length.toLocaleString("es-MX")} de{" "}
                {rawRows.length.toLocaleString("es-MX")} cargados
              </p>
            )}
          </div>
        ) : null}

        {/* Referencias no encontradas con PAGO VALIDADO (solo en CW, fuente payment) */}
        {kind === "onlyCw" && onlyCwWithPayment != null && onlyCwWithPayment.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <p className="text-sm font-medium text-amber-200/90">
              Referencias no encontradas con PAGO VALIDADO ({onlyCwWithPayment.length})
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50">
                    <TableHead>Referencia</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {onlyCwWithPayment.map((row) => (
                    <TableRow key={row.referencia} className="border-slate-700/50">
                      <TableCell className="font-mono text-sm">{row.referencia}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-xs border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.monto != null ? row.monto.toLocaleString("es-MX") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {!hasMonthFilter && displayRows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Mostrando {displayRows.length} registros por página. Use «Cargar más» para los siguientes.
          </p>
        )}

        {selectedMonths.size > 0 && filteredRows.length === 0 && (
          <div className="rounded-md border border-slate-700/50 bg-slate-800/30 px-4 py-3 text-sm text-muted-foreground">
            {hasMore ? (
              <>
                Buscando registros del mes seleccionado… ({rawRows.length.toLocaleString("es-MX")} cargados)
              </>
            ) : (
              <>No hay registros para el/los mes(es) seleccionado(s).</>
            )}
          </div>
        )}

        <div className="rounded-md border border-slate-700/50 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/50">
                <TableHead className="w-10">#</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead className="whitespace-nowrap">En paymentRecords</TableHead>
                <TableHead className="whitespace-nowrap">Mes CW</TableHead>
                <TableHead className="whitespace-nowrap">En datamapping</TableHead>
                <TableHead className="whitespace-nowrap">Mes DDB</TableHead>
                {kind === "onlyCw" && (
                  <>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Fuente</TableHead>
                  </>
                )}
                {kind === "onlyDdb" && (
                  <TableHead className="text-right">Monto</TableHead>
                )}
                {kind === "monthMismatch" && (
                  <>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Fuente</TableHead>
                  </>
                )}
                {kind === "mismatch" && (
                  <>
                    <TableHead>Fuente CW</TableHead>
                    <TableHead className="text-right">Monto CW</TableHead>
                    <TableHead className="text-right">Monto DDB</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((r, i) => {
                const effectiveCwMonth =
                  (kind === "onlyDdb" ? paymentMonthsByRef?.[r.referencia] : null) ??
                  (r.importMonth != null && r.importMonth !== "" ? r.importMonth : null);
                const effectiveDdbMonth =
                  (kind === "onlyCw" ? datamappingMonthsByRef?.[r.referencia] : null) ??
                  (r.datamappingUpdatedAt != null && r.datamappingUpdatedAt !== ""
                    ? timestampToMexicoMonth(r.datamappingUpdatedAt)
                    : null);
                return (
                <TableRow key={r._id} className="border-slate-700/50">
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {i + 1}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{r.referencia}</TableCell>
                  <TableCell className="text-xs">
                    {effectiveCwMonth != null ? "Sí" : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {effectiveCwMonth != null ? effectiveCwMonth : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {effectiveDdbMonth != null ? "Sí" : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {effectiveDdbMonth != null ? effectiveDdbMonth : "—"}
                  </TableCell>
                  {kind === "onlyCw" && (
                    <>
                      <TableCell className="text-right font-mono text-sm">
                        {r.monto != null ? r.monto.toLocaleString("es-MX") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.logSource ?? "—"}
                        </Badge>
                      </TableCell>
                    </>
                  )}
                  {kind === "onlyDdb" && (
                    <TableCell className="text-right font-mono text-sm">
                      {r.monto != null ? r.monto.toLocaleString("es-MX") : "—"}
                    </TableCell>
                  )}
                  {kind === "monthMismatch" && (
                    <>
                      <TableCell className="text-right font-mono text-sm">
                        {r.monto != null ? r.monto.toLocaleString("es-MX") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.logSource ?? "—"}
                        </Badge>
                      </TableCell>
                    </>
                  )}
                  {kind === "mismatch" && (
                    <>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {r.logSource ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {r.montoCloudWatch != null
                          ? r.montoCloudWatch.toLocaleString("es-MX")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-amber-400">
                        {r.montoDynamoDB != null
                          ? r.montoDynamoDB.toLocaleString("es-MX")
                          : "—"}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
        </div>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setCursor(page.continueCursor)}
          >
            Cargar más
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
