/**
 * Script para obtener estadísticas de reconciliación v1 y v2
 * para enero 1-31 de 2024 y 2025.
 *
 * Requiere: dashboard corriendo en http://localhost:3000
 * con AWS credentials y CLOUDWATCH_LOG_GROUP_V1/V2 configurados.
 */

const BASE_URL = "http://localhost:3000/api";

interface DaySummary {
  fecha: string;
  totalRegistros: number;
  montoTotal: number;
}

interface ApiResponse {
  success: boolean;
  version?: string;
  summary?: {
    totalPagos: number;
    montoTotal: number;
    porMovimiento?: Record<string, { total: number; monto: number }>;
  };
  byDay?: DaySummary[];
  dateRange?: { start: string; end: string };
  error?: string;
}

async function fetchPaymentsByDay(
  startDate: string,
  endDate: string,
  version: "v1" | "v2"
): Promise<ApiResponse> {
  const url = `${BASE_URL}/payments-by-day?startDate=${startDate}&endDate=${endDate}&version=${version}`;
  const res = await fetch(url);
  const data = (await res.json()) as ApiResponse;
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

async function main(): Promise<void> {
  const years = [2022, 2023, 2024, 2025, 2026];
  const periods = years.map((year) => ({
    year,
    start: `${year}-01-01`,
    end: `${year}-01-31`,
  }));

  console.log("=".repeat(70));
  console.log("Estadísticas de Reconciliación V1 - Enero por año");
  console.log("=".repeat(70));

  for (const period of periods) {
    console.log(`\n## Enero ${period.year} (${period.start} a ${period.end})\n`);

    for (const version of ["v1"] as const) {
      try {
        const data = await fetchPaymentsByDay(
          period.start,
          period.end,
          version
        );

        if (!data.success || !data.summary) {
          console.log(`  ${version.toUpperCase()}: Sin datos o error`);
          continue;
        }

        const { totalPagos, montoTotal, porMovimiento } = data.summary;

        console.log(`  --- ${version.toUpperCase()} ---`);
        console.log(`  Total pagos: ${totalPagos}`);
        console.log(`  Monto total: ${formatCurrency(montoTotal)}`);

        if (porMovimiento && Object.keys(porMovimiento).length > 0) {
          console.log("  Por movimiento:");
          for (const [mov, stats] of Object.entries(porMovimiento)) {
            console.log(`    - ${mov}: ${stats.total} pagos, ${formatCurrency(stats.monto)}`);
          }
        }

        if (data.byDay && data.byDay.length > 0) {
          console.log(`  Días con datos: ${data.byDay.length}`);
        }

        console.log("");
      } catch (err) {
        console.log(
          `  ${version.toUpperCase()}: Error - ${err instanceof Error ? err.message : String(err)}`
        );
        console.log("");
      }
    }
  }

  console.log("=".repeat(70));
}

main().catch(console.error);
