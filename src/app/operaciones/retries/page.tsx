"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import Link from "next/link";

export default function RetryCenterPage(): React.ReactElement {
  const result = useQuery(api.pipelineQueries.listPipelineJobs, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  const jobs = result?.page ?? [];
  const withRetry = jobs.filter((j) => j.status === "failed" || j.status === "running");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Retry Center</h1>
      <p className="text-sm text-slate-400">
        En el detalle de un run puedes usar Reintentar todas para volver a encolar las unidades
        fallidas.
      </p>
      <ul className="space-y-2">
        {withRetry.map((j) => (
          <li key={j._id}>
            <Link href={`/operaciones/runs/${j._id}`} className="text-sky-400 hover:underline text-sm">
              {j.jobType} — {j.status} — {new Date(j.startedAt).toLocaleString()}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
