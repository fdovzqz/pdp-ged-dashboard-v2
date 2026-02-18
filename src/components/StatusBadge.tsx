type Status = "pending" | "running" | "completed" | "failed" | "cancelled";

const STYLES: Record<Status, string> = {
  pending: "text-muted-foreground",
  running: "text-amber-400",
  completed: "text-emerald-400",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

const LABELS: Record<Status, string> = {
  pending: "Pendiente",
  running: "En curso",
  completed: "Completado",
  failed: "Error",
  cancelled: "Cancelado",
};

export function StatusBadge({
  status,
}: {
  status: Status;
}): React.ReactElement {
  return (
    <span className={STYLES[status] ?? ""}>{LABELS[status] ?? status}</span>
  );
}
