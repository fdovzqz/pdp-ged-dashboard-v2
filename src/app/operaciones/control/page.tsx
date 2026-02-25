"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import Link from "next/link";
import { StatusChip } from "@/components/ops/StatusChip";

export default function ControlCenterPage(): React.ReactElement {
  const jobs = useQuery(api.pipelineQueries.listPipelineJobs, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  const running = jobs?.page.filter((j) => j.status === "running") ?? [];
  const failed = jobs?.page.filter((j) => j.status === "failed") ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-100">Control Center</h1>
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm text-slate-400">Runs en curso</p>
          <p className="text-2xl font-semibold text-amber-400">{running.length}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm text-slate-400">Fallidos (página actual)</p>
          <p className="text-2xl font-semibold text-red-400">{failed.length}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm text-slate-400">Total en página</p>
          <p className="text-2xl font-semibold text-slate-100">{jobs?.page.length ?? 0}</p>
        </div>
      </section>
      {running.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-slate-200 mb-2">En curso</h2>
          <ul className="space-y-2">
            {running.map((j) => (
              <li key={j._id}>
                <Link
                  href={`/operaciones/runs/${j._id}`}
                  className="flex items-center gap-2 text-sm text-sky-400 hover:underline"
                >
                  <StatusChip status={j.status} />
                  {j.jobType} — {String(j.progress?.current ?? 0)} / {String(j.progress?.total ?? "?")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-slate-200 mb-2">Fallidos recientes</h2>
          <ul className="space-y-2">
            {failed.slice(0, 5).map((j) => (
              <li key={j._id}>
                <Link
                  href={`/operaciones/runs/${j._id}`}
                  className="flex items-center gap-2 text-sm text-sky-400 hover:underline"
                >
                  <StatusChip status={j.status} />
                  {j.jobType}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
