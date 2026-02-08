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
  onCancelSync?: () => void;
  syncing: boolean;
  progress: number;
  results: { inserted: number; deleted: number; failedDays?: string[] } | null;
  error: string | null;
  /** Rango del periodo (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  /** Fecha actualmente procesada (YYYY-MM-DD). */
  currentDate: string;
  /** Índice del día actual (1-based). */
  currentIndex: number;
  /** Total de fechas en el periodo. */
  totalDates: number;
}

export const SyncDialog = ({
  open,
  onOpenChange,
  onStartSync,
  onCancelSync,
  syncing,
  progress,
  results,
  error,
  startDate,
  endDate,
  currentDate,
  currentIndex,
  totalDates,
}: SyncDialogProps): React.ReactElement => {
  const descriptionText = `Se extraerán datos de CloudWatch para cada día del periodo ${startDate} a ${endDate}. Cada día tiene límite de 600s (Convex). Si un día falla, los demás continúan.`;

  const progressText =
    totalDates > 0
      ? `Procesando fecha ${currentDate} (${currentIndex} de ${totalDates})...`
      : "Preparando...";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sincronizar período</DialogTitle>
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
          {syncing ? (
            <>
              <Button disabled>Sincronizando...</Button>
              <Button
                variant="outline"
                onClick={onCancelSync}
                disabled={!onCancelSync}
              >
                Detener
              </Button>
            </>
          ) : results || error ? (
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          ) : (
            <>
              <Button onClick={onStartSync}>Iniciar sincronización</Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
