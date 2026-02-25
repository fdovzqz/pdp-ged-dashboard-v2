"use client";

import { useState, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "convex/_generated/api";
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
import { Button } from "@/components/ui/button";
import { FileBarChart, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type BreakdownResult = {
  period: { startMonth: string; endMonth: string };
  summary: {
    totalCwRecords: number;
    uniqueCwRefs: number;
    totalDdbRecordsPvMinusDec: number;
    uniqueDdbRefsPvMinusDec: number;
    onlyInDdbCount: number;
    diferencia: number;
  };
  onlyInDdbBreakdown: Array<{
    referencia: string;
    monto: number;
    categoria: "soloEnDataMapping" | "enCloudWatchOtroMes";
    cwImportMonth?: string;
    fechaTransaccionOrigen: "cloudWatch" | "updatedAt" | "indeterminado";
    ddbFechaTransaccionMexico: string;
  }>;
  duplicateCwRefs: string[];
  duplicateDdbRefs: string[];
  confirmacionPagoValidado: string;
};

const CATEGORIA_LABELS: Record<string, string> = {
  soloEnDataMapping: "Solo en DataMapping (no en CloudWatch)",
  enCloudWatchOtroMes: "En CloudWatch pero otro mes",
};

const FECHA_ORIGEN_LABELS: Record<string, string> = {
  cloudWatch: "CloudWatch (match)",
  updatedAt: "updatedAt (sin match CW)",
  indeterminado: "Indeterminado",
};

export default function DesglosePeriodoPage(): React.ReactElement {
  const runBreakdown = useAction(api.actions.getReconciliationBreakdownForPeriod);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BreakdownResult | null>(null);
  const [startMonth, setStartMonth] = useState("2026-01");
  const [endMonth, setEndMonth] = useState("2026-02");

  const handleRun = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await runBreakdown({ startMonth, endMonth });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar desglose");
    } finally {
      setLoading(false);
    }
  }, [runBreakdown, startMonth, endMonth]);

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileBarChart className="size-6" />
            Desglose reconciliación por periodo
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Explica la diferencia entre paymentRecords (CloudWatch) y DataMapping (PV-DEC) por periodo:
            identifica las transacciones en exceso en DataMapping, comprueba duplicados, confirma status PAGO VALIDADO
            y si la fecha usada vino de CloudWatch o de updatedAt.
          </p>
        </div>

        <Card className="border-slate-700/50 bg-slate-900/30">
          <CardHeader>
            <CardTitle className="text-base">Periodo</CardTitle>
            <CardDescription>
              Meses en formato YYYY-MM. Por defecto 2026-01 a 2026-02 para analizar los -4,283 de 2026.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Desde</label>
              <input
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Hasta</label>
              <input
                type="month"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
                className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
              />
            </div>
            <Button
              onClick={handleRun}
              disabled={loading || startMonth > endMonth}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generando…
                </>
              ) : (
                <>
                  <FileBarChart className="size-4" />
                  Generar desglose
                </>
              )}
            </Button>
            {startMonth > endMonth && (
              <span className="text-sm text-amber-500">Desde debe ser ≤ hasta</span>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-8 text-center">
            <Loader2 className="size-8 animate-spin mx-auto text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Leyendo CloudWatch y DataMapping por periodo…
            </p>
          </div>
        )}

        {result != null && !loading && (
          <div className="space-y-6">
            {/* Resumen */}
            <Card className="border-slate-700/50 bg-slate-900/30">
              <CardHeader>
                <CardTitle className="text-base">Resumen</CardTitle>
                <CardDescription>
                  {result.period.startMonth} a {result.period.endMonth}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">CloudWatch (registros / refs únicas)</p>
                  <p className="text-lg font-mono tabular-nums">
                    {result.summary.totalCwRecords.toLocaleString("es-MX")} / {result.summary.uniqueCwRefs.toLocaleString("es-MX")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">DataMapping PV-DEC (registros / refs únicas)</p>
                  <p className="text-lg font-mono tabular-nums">
                    {result.summary.totalDdbRecordsPvMinusDec.toLocaleString("es-MX")} / {result.summary.uniqueDdbRefsPvMinusDec.toLocaleString("es-MX")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Solo en DataMapping (exceso) / Diferencia</p>
                  <p className="text-lg font-mono tabular-nums">
                    {result.summary.onlyInDdbCount.toLocaleString("es-MX")} / {result.summary.diferencia >= 0 ? "+" : ""}{result.summary.diferencia.toLocaleString("es-MX")}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Confirmación PAGO VALIDADO */}
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="size-5" />
                  3) Confirmación PAGO VALIDADO
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {result.confirmacionPagoValidado}
                </p>
              </CardContent>
            </Card>

            {/* Duplicados */}
            <Card className="border-slate-700/50 bg-slate-900/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="size-5 text-amber-400" />
                  2) Duplicados por fuente
                </CardTitle>
                <CardDescription>
                  Referencias que aparecen más de una vez en el periodo (no explican por sí solas la diferencia de conteo único).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">CloudWatch</p>
                    <p className="font-mono tabular-nums">{result.duplicateCwRefs.length} referencias duplicadas</p>
                    {result.duplicateCwRefs.length > 0 && result.duplicateCwRefs.length <= 50 && (
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                        {result.duplicateCwRefs.slice(0, 20).join(", ")}
                        {result.duplicateCwRefs.length > 20 ? "…" : ""}
                      </p>
                    )}
                    {result.duplicateCwRefs.length > 50 && (
                      <p className="text-xs text-muted-foreground mt-1">Primeras 50: {result.duplicateCwRefs.slice(0, 50).join(", ")}…</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">DataMapping (PV-DEC)</p>
                    <p className="font-mono tabular-nums">{result.duplicateDdbRefs.length} referencias duplicadas</p>
                    {result.duplicateDdbRefs.length > 0 && result.duplicateDdbRefs.length <= 50 && (
                      <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
                        {result.duplicateDdbRefs.slice(0, 20).join(", ")}
                        {result.duplicateDdbRefs.length > 20 ? "…" : ""}
                      </p>
                    )}
                    {result.duplicateDdbRefs.length > 50 && (
                      <p className="text-xs text-muted-foreground mt-1">Primeras 50: {result.duplicateDdbRefs.slice(0, 50).join(", ")}…</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 1) y 4) Tabla onlyInDdb con categoría y origen de fecha */}
            <Card className="border-slate-700/50 bg-slate-900/30">
              <CardHeader>
                <CardTitle className="text-base">
                  1) Transacciones en exceso en DataMapping (onlyInDdb) — 4) Origen fechaTransaccion
                </CardTitle>
                <CardDescription>
                  Referencias que están en DataMapping (PV-DEC) con fechaTransaccion en el periodo pero no en CloudWatch en ese periodo.
                  Categoría: solo en DataMapping o en CloudWatch en otro mes. Origen: fecha de CloudWatch, updatedAt o indeterminado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.onlyInDdbBreakdown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay registros onlyInDdb en este periodo.</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-4">
                      Total: {result.onlyInDdbBreakdown.length.toLocaleString("es-MX")} referencias.
                      Mostrando todas.
                    </p>
                    <div className="rounded-md border border-slate-700/50 overflow-x-auto max-h-[60vh] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-slate-700/50">
                            <TableHead className="sticky top-0 bg-slate-900 z-10">Referencia</TableHead>
                            <TableHead className="sticky top-0 bg-slate-900 z-10 text-right">Monto</TableHead>
                            <TableHead className="sticky top-0 bg-slate-900 z-10">Categoría</TableHead>
                            <TableHead className="sticky top-0 bg-slate-900 z-10">Mes CW</TableHead>
                            <TableHead className="sticky top-0 bg-slate-900 z-10">Origen fecha</TableHead>
                            <TableHead className="sticky top-0 bg-slate-900 z-10">fechaTransaccion México</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.onlyInDdbBreakdown.map((row) => (
                            <TableRow key={row.referencia} className="border-slate-700/50">
                              <TableCell className="font-mono text-sm">{row.referencia}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {row.monto.toLocaleString("es-MX")}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  {CATEGORIA_LABELS[row.categoria] ?? row.categoria}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {row.cwImportMonth ?? "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    row.fechaTransaccionOrigen === "updatedAt"
                                      ? "text-amber-400 border-amber-500/50"
                                      : row.fechaTransaccionOrigen === "cloudWatch"
                                        ? "text-emerald-400 border-emerald-500/50"
                                        : ""
                                  }
                                >
                                  {FECHA_ORIGEN_LABELS[row.fechaTransaccionOrigen] ?? row.fechaTransaccionOrigen}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {row.ddbFechaTransaccionMexico || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
