"use client";

import { cn } from "@/lib/utils";

type Status = "pending" | "running" | "completed" | "failed" | "cancelled";

const STATUS_STYLES: Record<Status, string> = {
  pending: "bg-slate-500/30 text-slate-300 border-slate-500/50",
  running: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  failed: "bg-red-500/20 text-red-400 border-red-500/40",
  cancelled: "bg-slate-600/30 text-slate-400 border-slate-600/50",
};

export function StatusChip({ status }: { status: string }): React.ReactElement {
  const style = STATUS_STYLES[status as Status] ?? STATUS_STYLES.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
        style
      )}
    >
      {status}
    </span>
  );
}
