"use client";

import { motion } from "framer-motion";
import { useGetMovementDescription } from "@/hooks/useMovementDescription";

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);

interface MovementStat {
  movimiento: string;
  count: number;
  monto: number;
  v1: number;
  v2: number;
  payment: number;
}

interface MovementTableProps {
  byMovimiento: MovementStat[];
}

export const MovementTable = ({
  byMovimiento,
}: MovementTableProps): React.ReactElement => {
  const getDescription = useGetMovementDescription();
  const totalCount = byMovimiento.reduce((s, m) => s + m.count, 0);
  const totalMonto = byMovimiento.reduce((s, m) => s + m.monto, 0);
  const maxCount = Math.max(...byMovimiento.map((m) => m.count), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6 text-sm">
        <span className="text-muted-foreground">
          Tipos: <span className="text-foreground font-semibold">{byMovimiento.length}</span>
        </span>
        <span className="text-muted-foreground">
          Total: <span className="text-foreground font-semibold tabular-nums">{totalCount.toLocaleString()}</span> pagos
        </span>
        <span className="text-muted-foreground">
          Monto: <span className="text-foreground font-semibold tabular-nums">{formatCurrency(totalMonto)}</span>
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 bg-white/[0.02]">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Tipo de Movimiento</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Pagos</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden sm:table-cell">Monto</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider hidden sm:table-cell">% Pagos</th>
              <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-violet-400 hidden lg:table-cell">V1</th>
              <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-blue-400 hidden lg:table-cell">V2</th>
              <th className="text-right px-4 py-3 font-medium text-xs uppercase tracking-wider text-emerald-400 hidden lg:table-cell">EVO</th>
            </tr>
          </thead>
          <tbody>
            {byMovimiento.map((m, i) => {
              const pct = totalCount > 0 ? (m.count / totalCount) * 100 : 0;
              const label = getDescription(m.movimiento);

              return (
                <motion.tr
                  key={m.movimiento || "(sin tipo)"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03, duration: 0.3 }}
                  className="border-b border-border/30 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-1 h-6 rounded-full shrink-0"
                        style={{
                          opacity: 0.3 + (m.count / maxCount) * 0.7,
                          backgroundColor: "#818cf8",
                        }}
                      />
                      <span className="font-medium" title={label}>
                        {label}
                      </span>
                    </div>
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums font-semibold">
                    {m.count.toLocaleString()}
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-muted-foreground hidden sm:table-cell">
                    {formatCurrency(m.monto)}
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-muted-foreground hidden sm:table-cell">
                    {pct.toFixed(1)}%
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-violet-400/70 text-xs hidden lg:table-cell">
                    {m.v1 > 0 ? m.v1.toLocaleString() : "—"}
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-blue-400/70 text-xs hidden lg:table-cell">
                    {m.v2 > 0 ? m.v2.toLocaleString() : "—"}
                  </td>
                  <td className="text-right px-4 py-3 font-mono tabular-nums text-emerald-400/70 text-xs hidden lg:table-cell">
                    {m.payment > 0 ? m.payment.toLocaleString() : "—"}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
