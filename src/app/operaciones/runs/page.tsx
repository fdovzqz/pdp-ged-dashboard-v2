"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import Link from "next/link";
import { StatusChip } from "@/components/ops/StatusChip";

export default function RunsPage(): React.ReactElement {
  const result = useQuery(api.pipelineQueries.listPipelineJobs, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  const jobs = result?.page ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Runs</h1>
      <div className="rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-800/80 text-slate-400">
            <tr>
              <th className="px-4 py-2">jobType</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Progreso</th>
              <th className="px-4 py-2">Inicio</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j._id} className="border-t border-slate-700/50 hover:bg-slate-800/30">
                <td className="px-4 py-2 font-mono text-slate-300">{j.jobType}</td>
                <td className="px-4 py-2">
                  <StatusChip status={j.status} />
                </td>
                <td className="px-4 py-2 text-slate-400">
                  {j.progress?.current != null && j.progress?.total != null
                    ? `${j.progress.current} / ${j.progress.total}`
                    : "—"}
                </td>
                <td className="px-4 py-2 text-slate-400">
                  {j.startedAt ? new Date(j.startedAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2">
                  <Link href={`/operaciones/runs/${j._id}`} className="text-sky-400 hover:underline">
                    Detalle
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
