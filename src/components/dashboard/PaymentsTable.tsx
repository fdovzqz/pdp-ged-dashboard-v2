"use client";

import { Button } from "@/components/ui/button";
import { useGetMovementDescription } from "@/hooks/useMovementDescription";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown } from "lucide-react";

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(amount);

interface PaymentRecord {
  _id: string;
  referencia: string;
  monto: number;
  timestamp: string;
  fechaTransaccion: string;
  logSource: "v1" | "v2" | "payment";
  movimiento: string;
  estatus: string;
  importDate?: string;
}

type PaginationStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted";

interface PaymentsTableProps {
  records: PaymentRecord[];
  status: PaginationStatus;
  loadMore: (numItems: number) => void;
  sourceFilter: string;
  onSourceFilterChange: (value: string) => void;
}

const SOURCE_CONFIG: Record<string, { label: string; class: string }> = {
  v1: { label: "V1", class: "bg-violet-500/15 text-violet-400 border-violet-500/20" },
  v2: { label: "V2", class: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  payment: { label: "EVO", class: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
};

const LOAD_MORE_SIZE = 50;

export const PaymentsTable = ({
  records,
  status,
  loadMore,
  sourceFilter,
  onSourceFilterChange,
}: PaymentsTableProps): React.ReactElement => {
  const getDescription = useGetMovementDescription();
  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-4">
        <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
          <SelectTrigger className="w-[160px] bg-white/[0.03] border-border/50">
            <SelectValue placeholder="Fuente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las fuentes</SelectItem>
            <SelectItem value="v1">Conciliaci&oacute;n V1</SelectItem>
            <SelectItem value="v2">Conciliaci&oacute;n V2</SelectItem>
            <SelectItem value="payment">EVO (Payment)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {records.length.toLocaleString()} registros cargados
          {status === "CanLoadMore" || status === "LoadingMore"
            ? " (hay m\u00e1s disponibles)"
            : status === "Exhausted"
              ? " (todos cargados)"
              : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-white/[0.02]">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Fuente</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Referencia</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Monto</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">Movimiento</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">Fecha</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden lg:table-cell">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const config = SOURCE_CONFIG[r.logSource];
              return (
                <tr
                  key={r._id}
                  className="border-b border-border/30 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${config?.class ?? ""}`}>
                      {config?.label ?? r.logSource}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs tabular-nums">{r.referencia}</td>
                  <td className="text-right px-4 py-2.5 font-mono tabular-nums font-medium">
                    {formatCurrency(r.monto)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs hidden md:table-cell">
                    {getDescription(r.movimiento)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs hidden lg:table-cell">
                    {r.importDate ?? (r.fechaTransaccion
                      ? new Date(r.fechaTransaccion).toLocaleDateString("es-MX")
                      : "\u2014")}
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {r.estatus || "\u2014"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadMore(LOAD_MORE_SIZE)}
            disabled={status === "LoadingMore"}
            className="gap-2 bg-white/[0.03] border-border/50 hover:bg-white/[0.06]"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            {status === "LoadingMore"
              ? "Cargando..."
              : "Cargar m\u00e1s registros"}
          </Button>
        </div>
      )}
    </div>
  );
};
