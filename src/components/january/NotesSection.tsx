"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface AnalysisNote {
  id: string;
  yearLabel: string;
  title?: string;
  content: string;
  accentColor: string;
  order: number;
}

export interface NotesSectionProps {
  notes: AnalysisNote[];
  lastAvailableDay: number;
  monthName?: string;
}

const ACCENT_STYLES: Record<string, string> = {
  violet: "border-violet-500/40 bg-violet-500/10",
  emerald: "border-emerald-500/40 bg-emerald-500/10",
  cyan: "border-cyan-500/40 bg-cyan-500/10",
};

export const NotesSection = ({
  notes,
  lastAvailableDay,
  monthName = "Enero",
}: NotesSectionProps): React.ReactElement => {
  const interpolate = (text: string): string =>
    text
      .replace(/{lastAvailableDay}/g, String(lastAvailableDay))
      .replace(/{monthName}/g, monthName);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="glass-card rounded-xl p-6"
    >
      <h3 className="text-lg font-semibold mb-4">Notas de análisis</h3>
      <div className="space-y-4">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay notas. Edítalas desde la página de administración.
          </p>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className={cn(
                "rounded-lg p-4 border",
                ACCENT_STYLES[note.accentColor] ?? "border-slate-600/40 bg-slate-800/20"
              )}
            >
              {note.title && (
                <p className="text-sm font-medium mb-2">{note.title}</p>
              )}
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {interpolate(note.content)}
              </p>
            </div>
          ))
        )}
      </div>
    </motion.section>
  );
};
