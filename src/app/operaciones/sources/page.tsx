"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";

export default function SourcesCatalogPage(): React.ReactElement {
  const sources = useQuery(api.sources.listSources, {});

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Sources Catalog</h1>
      <p className="text-sm text-slate-400">
        Catálogo de fuentes de extracción. Onboarding de nuevas fuentes vía adapter + reglas + config
        sin tocar el core del engine.
      </p>

      {sources === undefined ? (
        <p className="text-slate-500 text-sm">Cargando fuentes…</p>
      ) : (
        <ul className="space-y-6">
          {sources.map((src) => (
            <li
              key={src.sourceKey}
              className="rounded-lg border border-slate-700 bg-slate-800/40 p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-medium text-slate-100">{src.label}</h2>
                <span className="rounded bg-slate-600 px-2 py-0.5 text-xs font-mono text-slate-300">
                  {src.sourceKey}
                </span>
              </div>
              <p className="text-sm text-slate-400 mb-2">{src.description}</p>
              <p className="text-xs text-slate-500 mb-3">
                Tabla destino: <code className="text-sky-400">{src.tableOrTarget}</code>
              </p>
              <div className="text-sm">
                <span className="text-slate-500">Job types asociados:</span>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {src.jobTypes.map(({ jobType, stages }) => (
                    <li
                      key={jobType}
                      className="rounded bg-slate-700/80 px-2 py-1 font-mono text-slate-300 text-xs"
                      title={`Stages: ${stages.join(" → ")}`}
                    >
                      {jobType}
                      <span className="ml-1 text-slate-500">[{stages.join(", ")}]</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
