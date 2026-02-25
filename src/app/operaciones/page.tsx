"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import Link from "next/link";

export default function OperacionesHomePage(): React.ReactElement {
  const jobs = useQuery(api.pipelineQueries.listPipelineJobs, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  const running = jobs?.page.filter((j) => j.status === "running").length ?? 0;
  const failed = jobs?.page.filter((j) => j.status === "failed").length ?? 0;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-100">Control Center</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm text-slate-400">Runs recientes</p>
          <p className="text-2xl font-semibold text-slate-100">{jobs?.page.length ?? 0}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm text-slate-400">En curso</p>
          <p className="text-2xl font-semibold text-amber-400">{running}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm text-slate-400">Fallidos</p>
          <p className="text-2xl font-semibold text-red-400">{failed}</p>
        </div>
      </div>
      <div>
        <Link href="/operaciones/runs" className="text-sky-400 hover:underline text-sm">
          Ver todos los runs
        </Link>
      </div>
    </div>
  );
}
