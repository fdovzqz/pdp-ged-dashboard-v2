"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export default function ConsultasReferenciaPage(): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const investigation = useQuery(api.reconciliationQueries.investigateReferenciaReconciliation, {
    referencia: submittedRef ?? "",
  });
  const paymentRecordsByRef = useQuery(api.cloudwatchQueries.searchByReferencia, {
    referencia: submittedRef ?? "",
  });

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Search className="size-6" />
            Consultas Referencia
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Investiga por qué una referencia aparece como solo CloudWatch, solo
            Datamapping o mismatch (ej. updatedAt fuera del periodo, precisión
            numérica).
          </p>
        </div>

        <Card className="border-slate-700/50 bg-slate-900/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Investigar referencia</CardTitle>
            <CardDescription>
              Ingresa una referencia de pago para ver su presencia en
              paymentRecords (CloudWatch) y datamappingRecords (DynamoDB).
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
                  {investigation.conclusion}
                </p>
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

            {submittedRef != null && submittedRef !== "" && (
              <Card className="border-slate-700/50 bg-slate-900/30 mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Registros en paymentRecords (CloudWatch)</CardTitle>
                  <CardDescription>
                    Todos los registros con referencia igual a{" "}
                    <span className="font-mono text-foreground">{submittedRef}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {paymentRecordsByRef === undefined ? (
                    <p className="text-sm text-muted-foreground">Cargando…</p>
                  ) : paymentRecordsByRef.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ningún registro en paymentRecords con esta referencia.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono border-collapse">
                        <thead>
                          <tr className="border-b border-slate-600 text-left">
                            <th className="py-1.5 pr-2">referencia</th>
                            <th className="py-1.5 pr-2">monto</th>
                            <th className="py-1.5 pr-2">timestamp</th>
                            <th className="py-1.5 pr-2">fechaTransaccion</th>
                            <th className="py-1.5 pr-2">logSource</th>
                            <th className="py-1.5 pr-2">movimiento</th>
                            <th className="py-1.5 pr-2">estatus</th>
                            <th className="py-1.5 pr-2">importMonth</th>
                            <th className="py-1.5 pr-2">importDate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentRecordsByRef.map((r, i) => (
                            <tr key={i} className="border-b border-slate-700/50">
                              <td className="py-1 pr-2">{r.referencia}</td>
                              <td className="py-1 pr-2">{r.monto}</td>
                              <td className="py-1 pr-2">{r.timestamp}</td>
                              <td className="py-1 pr-2">{r.fechaTransaccion}</td>
                              <td className="py-1 pr-2">{r.logSource}</td>
                              <td className="py-1 pr-2">{r.movimiento}</td>
                              <td className="py-1 pr-2">{r.estatus}</td>
                              <td className="py-1 pr-2">{r.importMonth}</td>
                              <td className="py-1 pr-2">{r.importDate ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-muted-foreground text-xs mt-2">
                        Total: {paymentRecordsByRef.length} registro(s)
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
