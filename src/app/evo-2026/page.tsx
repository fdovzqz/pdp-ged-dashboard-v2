import { Suspense } from "react";
import { Evo2026Dashboard } from "./Evo2026Dashboard";

export default function Evo2026Page(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-24 bg-slate-800/50 rounded-2xl" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-32 bg-slate-800/50 rounded-2xl" />
                ))}
              </div>
              <div className="h-96 bg-slate-800/50 rounded-2xl" />
              <div className="h-80 bg-slate-800/50 rounded-2xl" />
            </div>
          </div>
        </div>
      }
    >
      <Evo2026Dashboard />
    </Suspense>
  );
}
