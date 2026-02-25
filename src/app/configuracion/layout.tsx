"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, CloudDownload, Layers, Activity, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CONFIG_NAV_ITEMS = [
  { href: "/configuracion/datos", label: "Gestión de Datos", icon: Database },
  { href: "/configuracion/carga-fuentes", label: "Carga de Fuentes", icon: CloudDownload },
  { href: "/configuracion/registros-cargados", label: "Registros cargados", icon: BarChart2 },
  { href: "/configuracion/enriquecimiento-agregaciones", label: "Enriquecimiento y Agregaciones", icon: Layers },
  { href: "/configuracion/status", label: "Status de Actualizaciones", icon: Activity },
];

export default function ConfiguracionLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-january bg-grid">
      <div className="border-b border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <nav className="flex flex-wrap items-center gap-2">
            {CONFIG_NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
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
