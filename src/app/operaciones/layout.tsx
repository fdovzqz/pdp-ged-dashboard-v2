"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListTodo,
  AlertCircle,
  RotateCcw,
  BookOpen,
  Database,
  FileCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const OPS_NAV = [
  { href: "/operaciones/control", label: "Control Center", icon: LayoutDashboard },
  { href: "/operaciones/runs", label: "Runs", icon: ListTodo },
  { href: "/operaciones/errors", label: "Error Center", icon: AlertCircle },
  { href: "/operaciones/retries", label: "Retry Center", icon: RotateCcw },
  { href: "/operaciones/rules", label: "Rules Catalog", icon: BookOpen },
  { href: "/operaciones/sources", label: "Sources Catalog", icon: Database },
  { href: "/operaciones/audit", label: "Audit & Evidence", icon: FileCheck },
];

export default function OperacionesLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/operaciones"
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium",
                pathname === "/operaciones"
                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/40"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              Operaciones
            </Link>
            {OPS_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    active
                      ? "bg-sky-500/20 text-sky-400 border border-sky-500/40"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
