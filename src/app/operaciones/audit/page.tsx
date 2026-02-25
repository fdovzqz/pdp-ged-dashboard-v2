"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import Link from "next/link";

export default function AuditEvidencePage(): React.ReactElement {
  const result = useQuery(api.pipelineQueries.listPipelineJobs, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  const jobs = result?.page ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Audit & Evidence</h1>
      <p className="text-sm text-slate-400">
        Export de evidencia por corrida: eventos de auditoría (run.started, unit.completed,
        unit.failed, run.completed, run.failed). Selecciona un run para ver su evidencia.
      </p>
      <ul className="space-y-2">
        {jobs.map((j) => (
          <li key={j._id}>
            <Link
              href={`/operaciones/runs/${j._id}`}
              className="text-sky-400 hover:underline text-sm"
            >
              {j.jobType} — {j.status} — {new Date(j.startedAt).toLocaleString()}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
