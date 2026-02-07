"use client";

import { motion } from "framer-motion";

interface DayStatus {
  date: string;
  count: number;
}

interface IngestionStatusProps {
  month: string;
  totalRecords: number;
  daysWithData: number;
  byDate: DayStatus[];
}

export const IngestionStatus = ({
  totalRecords,
  daysWithData,
  byDate,
}: IngestionStatusProps): React.ReactElement => {
  const maxCount = Math.max(...byDate.map((d) => d.count), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-card rounded-xl p-5"
    >
      <div className="flex flex-wrap items-center gap-6 mb-4">
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
            Registros Cargados
          </p>
          <p className="text-lg font-bold tabular-nums">{totalRecords.toLocaleString()}</p>
        </div>
        <div className="w-px h-8 bg-border/50" />
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
            D&iacute;as con Datos
          </p>
          <p className="text-lg font-bold tabular-nums">{daysWithData} <span className="text-sm text-muted-foreground font-normal">/ 31</span></p>
        </div>
      </div>

      {/* Activity heatmap */}
      {byDate.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Actividad por D&iacute;a
          </p>
          <div className="flex gap-1 flex-wrap">
            {byDate.map(({ date, count }) => {
              const intensity = count / maxCount;
              const dayNum = date.slice(8);
              return (
                <div
                  key={date}
                  title={`${date}: ${count.toLocaleString()} registros`}
                  className="flex flex-col items-center gap-0.5 group cursor-default"
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-medium transition-transform group-hover:scale-110"
                    style={{
                      backgroundColor: `rgba(129, 140, 248, ${0.08 + intensity * 0.5})`,
                      color: intensity > 0.5 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {dayNum}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
};
