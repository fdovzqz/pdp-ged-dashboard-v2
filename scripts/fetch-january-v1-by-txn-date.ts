/**
 * Obtiene pagos V1 de Enero 2025 filtrados por fechaTransaccion (fecha real del pago)
 * y deduplicados por referencia.
 *
 * Ejecuta múltiples queries por semana para superar el límite de 10k de CloudWatch.
 *
 * Requiere: dashboard corriendo en http://localhost:3000
 */

const BASE_URL = "http://localhost:3000/api";

interface PaymentRecord {
  referencia: string;
  monto: number;
  movimiento: string;
  fechaTransaccion: string;
}

interface TxnDateResponse {
  success: boolean;
  txnMonth: string;
  statistics?: { recordsMatched: number };
  summary?: {
    totalPagos: number;
    montoTotal: number;
    porMovimiento: Record<string, number>;
  };
  pagos?: PaymentRecord[];
  error?: string;
}

async function fetchByTxnDate(
  txnMonth: string,
  logStartDate: string,
  logEndDate: string
): Promise<TxnDateResponse> {
  const url = `${BASE_URL}/payments-by-txn-date?txnMonth=${txnMonth}&version=v1&logStartDate=${logStartDate}&logEndDate=${logEndDate}`;
  const res = await fetch(url);
  const data = (await res.json()) as TxnDateResponse;
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
  console.log("=".repeat(70));
  console.log("V1 - Pagos con fechaTransaccion en Enero 2025 (deduplicados por referencia)");
  console.log("=".repeat(70));

  // Más rangos para mayor cobertura (CloudWatch limit 10k por query)
  const ranges = [
    { start: "2025-01-01", end: "2025-01-05" },
    { start: "2025-01-06", end: "2025-01-10" },
    { start: "2025-01-11", end: "2025-01-15" },
    { start: "2025-01-16", end: "2025-01-20" },
    { start: "2025-01-21", end: "2025-01-25" },
    { start: "2025-01-26", end: "2025-01-31" },
  ];

  const allPayments = new Map<string, PaymentRecord>();

  try {
    for (const range of ranges) {
      const data = await fetchByTxnDate("2025-01", range.start, range.end);
      if (!data.success || !data.pagos) continue;
      for (const p of data.pagos) {
        if (!allPayments.has(p.referencia)) {
          allPayments.set(p.referencia, p);
        }
      }
    }

    const totalPagos = allPayments.size;
    const montoTotal = [...allPayments.values()].reduce((s, p) => s + p.monto, 0);
    const porMovimiento: Record<string, number> = {};
    for (const p of allPayments.values()) {
      const mov = p.movimiento || "(sin movimiento)";
      porMovimiento[mov] = (porMovimiento[mov] || 0) + 1;
    }

    console.log("\nCriterio: fechaTransaccion entre 2025-01-01 y 2025-01-31");
    console.log("Deduplicación: por referencia (un pago = una referencia)");
    console.log("Método: 6 queries por rango de días (CloudWatch limit 10k/query)\n");
    console.log(`Total pagos únicos: ${totalPagos}`);
    console.log(`Monto total: ${formatCurrency(montoTotal)}`);

    if (Object.keys(porMovimiento).length > 0) {
      console.log("\nPor movimiento:");
      for (const [mov, count] of Object.entries(porMovimiento).sort(
        (a, b) => b[1] - a[1]
      )) {
        console.log(`  - ${mov}: ${count} pagos`);
      }
    }

    console.log("\n" + "=".repeat(70));
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
  }
}

main();
