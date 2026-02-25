"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CopyCheck, GitCompare, Search, FileSearch, FileBarChart } from "lucide-react";
import { cn } from "@/lib/utils";

const RECONCILIACION_NAV_ITEMS = [
  { href: "/reconciliacion/chequeo-duplicados", label: "Chequeo de duplicados", icon: CopyCheck },
  { href: "/reconciliacion/diferencias-fuentes", label: "Diferencias entre fuentes", icon: GitCompare },
  { href: "/reconciliacion/desglose-periodo", label: "Desglose por periodo", icon: FileBarChart },
  { href: "/reconciliacion/consultas-referencia", label: "Consultas Referencia", icon: Search },
  {
    href: "/reconciliacion/consultas-referencia-rfc-placa",
    label: "Consultas: Referencia, RFC, Placa",
    icon: FileSearch,
  },
];

export default function ReconciliacionLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <nav className="flex flex-wrap items-center gap-2">
            {RECONCILIACION_NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    active
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
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
      </div>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
