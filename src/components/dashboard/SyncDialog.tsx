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
}: SyncDialogProps): React.ReactElement => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sincronizar mes completo</DialogTitle>
          <DialogDescription>
            Se extraerán datos de CloudWatch para cada día de {month}. Cada día
            tiene límite de 600s (Convex). Si un día falla, los demás continúan.
          </DialogDescription>
        </DialogHeader>
        {syncing && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Procesando día {currentDay} de {totalDays}...
            </p>
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
