"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, BarChart3, GitCompare, Settings, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Análisis Mensual", icon: CalendarDays },
  { href: "/anual", label: "Análisis Anual", icon: BarChart3 },
  { href: "/configuracion", label: "Configuración", icon: Settings },
  { href: "/operaciones", label: "Operaciones", icon: LayoutDashboard },
  { href: "/reconciliacion", label: "Reconciliación", icon: GitCompare },
];

export const Nav = (): React.ReactElement => {
  const pathname = usePathname();

  return (
    <nav className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-3">
        <div className="flex items-center gap-6">
          {/* App branding */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <Image
              src="/icon.svg"
              alt="PdP-DGO Logo"
              width={28}
              height={28}
              className="rounded-md"
            />
            <span className="text-sm font-semibold tracking-tight text-slate-100">
              PdP-DGO
              <span className="hidden sm:inline text-emerald-400/80 font-normal ml-1">
                Dashboard Financiero
              </span>
            </span>
          </Link>

          {/* Separator */}
          <div className="h-5 w-px bg-slate-700/60" />

          {/* Nav items */}
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href ||
              (item.href === "/configuracion" && pathname.startsWith("/configuracion")) ||
              (item.href === "/operaciones" && pathname.startsWith("/operaciones")) ||
              (item.href === "/reconciliacion" && pathname.startsWith("/reconciliacion"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  active
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
