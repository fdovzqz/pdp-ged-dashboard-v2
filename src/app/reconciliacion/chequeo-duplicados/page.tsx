"use client";

import { useState, useCallback } from "react";
import { useAction, useQuery } from "convex/react";
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
import { Button } from "@/components/ui/button";
import { CopyCheck, Loader2 } from "lucide-react";
import { PERIOD_START, PERIOD_END, generateMonthRange } from "@/lib/constants";

const ALL_MONTHS = generateMonthRange(PERIOD_START, PERIOD_END);

export default function ChequeoDuplicadosPage(): React.ReactElement {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullResult, setFullResult] = useState<{
    totalRecords: number;
    uniqueReferencias: number;
    duplicateReferencias: number;
    totalDuplicateRecords: number;
    top: Array<{ referencia: string; count: number }>;
  } | null>(null);
  const [selectedMonth, setSelectedMonth] = useState("2026-01");

  const checkDuplicateReferencias = useAction(api.actions.checkDuplicateReferencias);
  const monthResult = useQuery(api.queries.findDuplicateReferenciasInMonth, {
    month: selectedMonth,
  });

  const handleRunFullCheck = useCallback(async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setFullResult(null);
    try {
      const res = await checkDuplicateReferencias({ limit: 100 });
      setFullResult({
        totalRecords: res.totalRecords,
        uniqueReferencias: res.uniqueReferencias,
        duplicateReferencias: res.duplicateReferencias,
        totalDuplicateRecords: res.totalDuplicateRecords,
        top: res.top,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al verificar duplicados");
    } finally {
      setRunning(false);
    }
  }, [checkDuplicateReferencias]);

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CopyCheck className="size-6" />
            Chequeo de duplicados
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Verifica referencias duplicadas en paymentRecords (CloudWatch). Un
            duplicado indica la misma referencia en más de un registro para el
            mismo mes o en distintos meses.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Chequeo completo (acción, todos los meses) */}
        <Card className="border-slate-700/50 bg-slate-900/30">
          <CardHeader>
            <CardTitle className="text-base">Chequeo completo (todo el período)</CardTitle>
            <CardDescription>
              Itera por todos los meses (2024-01 a 2026-02). Puede tardar varios
              minutos. Muestra hasta 100 referencias duplicadas más frecuentes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={handleRunFullCheck}
              disabled={running}
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CopyCheck className="size-4" />
              )}
              {running ? "Verificando..." : "Ejecutar chequeo completo"}
            </Button>
            {fullResult && !running && (
              <div className="mt-4 space-y-2 text-sm">
                <p>
                  Total registros: <strong>{fullResult.totalRecords.toLocaleString()}</strong>
                  {" · "}
                  Referencias únicas: <strong>{fullResult.uniqueReferencias.toLocaleString()}</strong>
                </p>
                <p>
                  Referencias duplicadas:{" "}
                  <strong className="text-amber-400">{fullResult.duplicateReferencias}</strong>
                  {" · "}
                  Registros en duplicados:{" "}
                  <strong>{fullResult.totalDuplicateRecords.toLocaleString()}</strong>
                </p>
                {fullResult.top.length > 0 && (
                  <div className="rounded-md border border-slate-700/50 overflow-hidden mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700/50">
                          <TableHead className="text-slate-300">Referencia</TableHead>
                          <TableHead className="text-slate-300 text-right">Veces</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fullResult.top.map((d) => (
                          <TableRow key={d.referencia} className="border-slate-700/50">
                            <TableCell className="font-mono text-sm">
                              {d.referencia}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {d.count}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Por mes (query, instantáneo) */}
        <Card className="border-slate-700/50 bg-slate-900/30">
          <CardHeader>
            <CardTitle className="text-base">Por mes</CardTitle>
            <CardDescription>
              Resultado inmediato para un solo mes (sin ejecutar acción).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-sm text-muted-foreground">Mes:</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
              >
                {ALL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {monthResult && (
              <div className="space-y-2 text-sm">
                <p>
                  Total registros: <strong>{monthResult.totalRecords.toLocaleString()}</strong>
                  {" · "}
                  Referencias únicas: <strong>{monthResult.uniqueReferencias.toLocaleString()}</strong>
                </p>
                <p>
                  Referencias duplicadas:{" "}
                  <strong className={monthResult.duplicateReferencias > 0 ? "text-amber-400" : ""}>
                    {monthResult.duplicateReferencias}
                  </strong>
                  {" · "}
                  Registros en duplicados:{" "}
                  <strong>{monthResult.totalDuplicateRecords.toLocaleString()}</strong>
                </p>
                {monthResult.top.length > 0 && (
                  <div className="rounded-md border border-slate-700/50 overflow-hidden mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700/50">
                          <TableHead className="text-slate-300">Referencia</TableHead>
                          <TableHead className="text-slate-300 text-right">Veces</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {monthResult.top.map((d) => (
                          <TableRow key={d.referencia} className="border-slate-700/50">
                            <TableCell className="font-mono text-sm">
                              {d.referencia}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {d.count}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
