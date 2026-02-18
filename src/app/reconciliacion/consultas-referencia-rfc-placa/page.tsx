"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useAction } from "convex/react";
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
import { AlertCircle, Download, FileText, Loader2, Search } from "lucide-react";
import { timestampToMexicoDate } from "@/lib/mexicoDateRange";

/** RFCs a investigar: contribuyentes que pagaron algún tipo de declaración. */
const RFC_LIST = [
  "BBA030609AM8",
  "AAAA801014M1A",
  "AAFM820208534",
  "AAFY000305MJ6",
  "AID740730RM1",
  "BMI221107TR9",
  "BTR2209265B4",
  "CAAL751230LW7",
  "CEC9904146T2",
  "CHH1501093I4",
  "CME1308283F8",
  "CMM0312165F6",
  "CNA010605Q50",
  "CNA890116SF2",
  "CPH0802297G9",
  "CPI240125QB7",
  "CPM110719SG3",
  "DCE131011HH2",
  "DIN030224KU5",
  "GARF60128FJ8",
  "GARF8405011M8",
  "GOPJ021014AM9",
  "GORR8807287L7",
  "GPS210621M14",
  "GSP9607102L9",
  "HELE7211031R1",
  "HESE950105IE1",
  "HRD101209QS5",
  "HVE000523D32",
  "IEL020207E82",
  "ILI810511RQA",
  "IMA010201144",
  "INE140404NI0",
  "IVE820430M47",
  "JAND7112295U5",
  "JOP810218E71",
  "MMU970204DG7",
  "MOY970124CF1",
  "MRO960820JC2",
  "MSC080711EA3",
  "NME180725BE8",
  "NUDC671202RE5",
  "PAD040811566",
  "PCE140530632",
  "PED781129JT6",
  "PIN941105IQA",
  "QUMC600326J57",
  "REC050818C37",
  "ROGH610509HZ4",
  "RORR4010193M8",
  "SAMX7509083L1",
  "SIB8606304P3",
  "SPM860820CF5",
  "STP401231P53",
  "TAN190524SQ4",
  "TCH850701RM1",
  "VAOL780925HY0",
  "VATG560409LU5",
];

type Match = {
  rfc: string;
  referencia: string;
  monto: number;
  updatedAt: string;
  tipoMovimiento?: string;
  fuente?: string;
  status?: string;
  loteId?: string;
  tramiteId?: string;
  reciboPagoUrl?: string;
  endMonth?: string;
  declarationType?: string;
};

/** URL del recibo: reciboPagoUrl (nombre correcto) o referenciaPagoUrl (datos guardados antes del cambio). */
function getReciboUrl(m: Match): string | undefined {
  const url = m.reciboPagoUrl ?? (m as { referenciaPagoUrl?: string }).referenciaPagoUrl;
  return url && typeof url === "string" && url.trim() !== "" ? url.trim() : undefined;
}

function escapeCsv(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(matches: Match[]): string {
  const header =
    "RFC,referencia,monto,fechaPago,tipoMovimiento,status,source,loteId,tramiteId,reciboPagoUrl,endMonth,declarationType\n";
  const body = matches
    .map((m) =>
      [
        escapeCsv(m.rfc),
        escapeCsv(m.referencia),
        m.monto,
        escapeCsv(timestampToMexicoDate(m.updatedAt) || m.updatedAt),
        escapeCsv(m.tipoMovimiento ?? ""),
        escapeCsv(m.status ?? ""),
        escapeCsv(m.fuente ?? ""),
        escapeCsv(m.loteId ?? ""),
        escapeCsv(m.tramiteId ?? ""),
        escapeCsv(m.reciboPagoUrl ?? ""),
        escapeCsv(m.endMonth ?? ""),
        escapeCsv(m.declarationType ?? ""),
      ].join(",")
    )
    .join("\n");
  return "\uFEFF" + header + body;
}

function formatRunAt(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function ConsultasReferenciaRfcPlacaPage(): React.ReactElement {
  const savedResults = useQuery(api.queries.getLatestRfcInvestigationResults);
  const runAction = useAction(api.actions.runRfcInvestigationAndSave);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = savedResults?.matches ?? [];

  const handleSearchAndSave = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await runAction({ rfcs: RFC_LIST });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al buscar");
    } finally {
      setRunning(false);
    }
  }, [runAction]);

  const downloadCsv = useCallback(() => {
    if (matches.length === 0) return;
    const csv = buildCsv(matches);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rfc-referencias-pagos-enero-a-fecha.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [matches]);

  const rfcWithMatches = new Set(matches.map((m) => m.rfc));
  const rfcWithoutMatches = RFC_LIST.filter((r) => !rfcWithMatches.has(r));
  const isLoading = savedResults === undefined;

  /** Agrupa referencias por RFC para mostrar cada RFC con sus referencias juntas. */
  const matchesByRfc = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of matches) {
      const list = map.get(m.rfc) ?? [];
      list.push(m);
      map.set(m.rfc, list);
    }
    return map;
  }, [matches]);

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <FileText className="size-6" />
              Consultas: Referencia, RFC, Placa
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Consulta por <strong>Referencia</strong>: usa{" "}
              <Link href="/reconciliacion/consultas-referencia" className="text-emerald-400 hover:text-emerald-300 underline">
                Consultas Referencia
              </Link>
              . Por <strong>RFC</strong>: lista fija de RFC y búsqueda guardada abajo. Por <strong>Placa</strong>: próximamente.
              Requiere enriquecimiento en{" "}
              <Link href="/configuracion/datos" className="text-emerald-400 hover:text-emerald-300 underline">
                Configuración → Datos
              </Link>
              .
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={handleSearchAndSave}
              disabled={running || isLoading}
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Buscar y guardar
            </Button>
            {matches.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={downloadCsv}
              >
                <Download className="size-4" />
                Exportar CSV
              </Button>
            )}
          </div>
        </div>

        {/* Placa: placeholder */}
        <Card className="border-slate-700/50 bg-slate-900/30 border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Consulta por Placa</CardTitle>
            <CardDescription>
              Búsqueda por placa en datamappingRecords (cuando esté disponible).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Próximamente.</p>
          </CardContent>
        </Card>

        {/* Info */}
        <Card className="border-slate-700/50 bg-slate-900/30">
          <CardHeader>
            <CardTitle className="text-base">Lista de RFC</CardTitle>
            <CardDescription>
              {RFC_LIST.length} RFC que pagaron algún tipo de declaración. Rango de búsqueda: desde 1 de enero 2026 hasta la fecha actual.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {RFC_LIST.slice(0, 12).map((rfc) => (
                <Badge key={rfc} variant="secondary" className="font-mono text-xs">
                  {rfc}
                </Badge>
              ))}
              {RFC_LIST.length > 12 && (
                <Badge variant="outline" className="text-muted-foreground">
                  +{RFC_LIST.length - 12} más
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Results table */}
        {isLoading && (
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-8 text-center text-muted-foreground">
            Cargando...
          </div>
        )}

        {!isLoading && savedResults && (
          <Card className="border-slate-700/50 bg-slate-900/30">
            <CardHeader>
              <CardTitle className="text-base">Resultados guardados</CardTitle>
              <CardDescription>
                {matches.length} referencias encontradas para {rfcWithMatches.size} RFC.
                Rango: {savedResults.fromDate} a {savedResults.toDate}.
                Ejecutado: {formatRunAt(savedResults.runAt)}.
                {rfcWithoutMatches.length > 0 && (
                  <span className="block mt-1 text-amber-400/90">
                    {rfcWithoutMatches.length} RFC sin coincidencias.
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {matches.length > 0 ? (
                <div className="space-y-6">
                  {Array.from(matchesByRfc.entries()).map(([rfc, refs]) => (
                    <div key={rfc} className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">
                          {rfc}
                        </Badge>
                        <span>{refs.length} referencia{refs.length !== 1 ? "s" : ""}</span>
                      </h3>
                      <div className="overflow-x-auto rounded-md border border-slate-700/50">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Referencia</TableHead>
                              <TableHead className="text-right">Monto</TableHead>
                              <TableHead>Fecha pago</TableHead>
                              <TableHead>Tipo movimiento</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Source</TableHead>
                              <TableHead>Lote ID</TableHead>
                              <TableHead>Trámite ID</TableHead>
                              <TableHead>URL recibo</TableHead>
                              <TableHead>End month</TableHead>
                              <TableHead>Tipo declaración</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(() => {
                              const decRefs = refs.filter(
                                (m) => (m.fuente ?? "").toUpperCase() === "DEC"
                              );
                              const nonDecRefs = refs.filter(
                                (m) => (m.fuente ?? "").toUpperCase() !== "DEC"
                              );
                              const decAggregated =
                                decRefs.length > 0
                                  ? {
                                      referencia: `DEC (${decRefs.length} pago${decRefs.length !== 1 ? "s" : ""})`,
                                      monto: decRefs.reduce((s, m) => s + m.monto, 0),
                                      updatedAt: decRefs[0]?.updatedAt ?? "",
                                      tipoMovimiento: decRefs[0]?.tipoMovimiento ?? "—",
                                      status: decRefs.some(
                                        (m) =>
                                          (m.status ?? "").toUpperCase() === "PAGO VALIDADO"
                                      )
                                        ? "PAGO VALIDADO"
                                        : decRefs[0]?.status ?? "—",
                                      fuente: "DEC" as const,
                                      isDecRow: true,
                                    }
                                  : null;
                              type RefTableRow =
                                | (Match & { isDecRow?: boolean })
                                | {
                                    referencia: string;
                                    monto: number;
                                    updatedAt: string;
                                    tipoMovimiento: string;
                                    status: string;
                                    fuente: "DEC";
                                    isDecRow: boolean;
                                  };
                              const rowsToShow: RefTableRow[] = [
                                ...nonDecRefs.map((m) => ({ ...m, isDecRow: false })),
                                ...(decAggregated ? [decAggregated] : []),
                              ];
                              return rowsToShow.map((m, i) => (
                                <TableRow
                                  key={
                                    m.isDecRow
                                      ? `${rfc}-dec-aggregated`
                                      : `${"rfc" in m ? m.rfc : rfc}-${m.referencia}-${i}`
                                  }
                                >
                                  <TableCell className="font-mono text-sm">
                                    {m.referencia}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    ${m.monto.toLocaleString("es-MX")}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {m.isDecRow
                                      ? "—"
                                      : timestampToMexicoDate(m.updatedAt) || m.updatedAt.slice(0, 10)}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {m.tipoMovimiento ?? "—"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={
                                        (m.status ?? "").toUpperCase() === "PAGO VALIDADO"
                                          ? "text-xs border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                                          : "text-xs"
                                      }
                                    >
                                      {m.status ?? "—"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-xs">
                                      {m.fuente ?? "—"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {!("isDecRow" in m && m.isDecRow)
                                      ? ((m as Match).loteId ?? "—")
                                      : "—"}
                                  </TableCell>
                                  <TableCell
                                    className="font-mono text-xs max-w-[120px] truncate"
                                    title={!("isDecRow" in m && m.isDecRow) ? (m as Match).tramiteId : undefined}
                                  >
                                    {!("isDecRow" in m && m.isDecRow)
                                      ? ((m as Match).tramiteId ?? "—")
                                      : "—"}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {!("isDecRow" in m && m.isDecRow) && getReciboUrl(m as Match) ? (
                                      <a
                                        href={getReciboUrl(m as Match)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-emerald-400 hover:text-emerald-300 underline truncate block max-w-[140px]"
                                        title={getReciboUrl(m as Match)}
                                      >
                                        Recibo
                                      </a>
                                    ) : (
                                      "—"
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-xs">
                                    {!("isDecRow" in m && m.isDecRow)
                                      ? ((m as Match).endMonth ?? "—")
                                      : "—"}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {!("isDecRow" in m && m.isDecRow)
                                      ? ((m as Match).declarationType ?? "—")
                                      : "—"}
                                  </TableCell>
                                </TableRow>
                              ));
                            })()}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No hay resultados guardados. Pulsa <strong>Buscar y guardar</strong> para ejecutar
                  la investigación (rango: 1 enero a hoy) y guardar en la tabla.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* RFC sin coincidencias */}
        {!isLoading && savedResults && rfcWithoutMatches.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="size-4 text-amber-500" />
                RFC sin coincidencias
              </CardTitle>
              <CardDescription>
                {rfcWithoutMatches.length} RFC de la lista no tienen referencias de pago en datamapping
                en el rango {savedResults.fromDate}–{savedResults.toDate}. Pueden no haber pagado en ese
                periodo o el RFC no estar presente en el JSON enriquecido.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {rfcWithoutMatches.map((rfc) => (
                  <Badge
                    key={rfc}
                    variant="outline"
                    className="font-mono text-xs border-amber-500/40 text-amber-200/90"
                  >
                    {rfc}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {!isLoading && !savedResults && (
          <Card className="border-slate-700/50 bg-slate-900/30 border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              <p className="mb-2">
                No hay resultados guardados. Pulsa <strong>Buscar y guardar</strong> para ejecutar
                la investigación y guardar los resultados en la tabla.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-2"
                onClick={handleSearchAndSave}
                disabled={running}
              >
                {running ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Buscar y guardar
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
