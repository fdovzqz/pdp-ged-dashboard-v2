import { Suspense } from "react";
import { DashboardContent } from "./DashboardContent";
import { DashboardSkeleton } from "@/components/january";

export default function Home(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-january dot-pattern p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            <DashboardSkeleton />
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
