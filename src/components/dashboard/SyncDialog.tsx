"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartSync: () => void;
  syncing: boolean;
  progress: number;
  currentDay: number;
  totalDays: number;
  results: { inserted: number; deleted: number; failedDays?: string[] } | null;
  error: string | null;
  month: string;
  /** Multi-mes: rango del periodo. */
  startMonth?: string;
  endMonth?: string;
  /** Multi-mes: mes actualmente procesado. */
  currentMonth?: string;
  /** Multi-mes: índice del mes actual (1-based). */
  currentMonthIndex?: number;
  /** Multi-mes: total de meses en el periodo. */
  totalMonths?: number;
}

export const SyncDialog = ({
  open,
  onOpenChange,
  onStartSync,
  syncing,
  progress,
  currentDay,
  totalDays,
  results,
  error,
  month,
  startMonth,
  endMonth,
  currentMonth,
  currentMonthIndex = 1,
  totalMonths = 1,
}: SyncDialogProps): React.ReactElement => {
  const isMultiMonth =
    startMonth !== undefined &&
    endMonth !== undefined &&
    totalMonths > 1;

  const descriptionText = isMultiMonth
    ? `Se extraerán datos de CloudWatch para cada día del periodo ${startMonth} a ${endMonth}. Cada día tiene límite de 600s (Convex). Si un día falla, los demás continúan.`
    : `Se extraerán datos de CloudWatch para cada día de ${month}. Cada día tiene límite de 600s (Convex). Si un día falla, los demás continúan.`;

  const progressText = isMultiMonth
    ? `Mes ${currentMonthIndex} de ${totalMonths} (${currentMonth ?? month}) — Día ${currentDay} de ${totalDays}`
    : `Procesando día ${currentDay} de ${totalDays}...`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isMultiMonth ? "Sincronizar período" : "Sincronizar mes completo"}
          </DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
        </DialogHeader>
        {syncing && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{progressText}</p>
            <Progress value={progress} />
          </div>
        )}
        {results && !syncing && (
          <div className="space-y-2">
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-300">
              Sincronización completada. Insertados: {results.inserted} |
              Eliminados: {results.deleted}
            </div>
            {results.failedDays && results.failedDays.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Días fallidos: {results.failedDays.join(", ")}
              </p>
            )}
          </div>
        )}
        {error && !syncing && (
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onStartSync} disabled={syncing}>
            {syncing ? "Sincronizando..." : "Iniciar sincronización"}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={syncing}
          >
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
