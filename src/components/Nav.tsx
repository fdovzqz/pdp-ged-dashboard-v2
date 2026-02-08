"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Análisis Mensual", icon: CalendarDays },
  { href: "/upload", label: "Datos", icon: Upload },
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
            const active = pathname === item.href;
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
