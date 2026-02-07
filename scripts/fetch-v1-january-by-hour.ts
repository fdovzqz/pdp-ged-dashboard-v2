/**
 * Obtiene pagos V1 de Enero 2025 agrupados por hora (fechaTransaccion).
 * Deduplicados por referencia.
 *
 * Requiere: dashboard corriendo en http://localhost:3000
 *
 * Uso: npx tsx scripts/fetch-v1-january-by-hour.ts
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

/** Hora en zona México (UTC-6) por defecto. Pasar false para UTC. */
const USE_MEXICO_TZ = true;

function getHourFromFechaTransaccion(fecha: string): number {
  // Formato: "2025-01-30T18:08:49.737421Z"
  const match = fecha.match(/T(\d{2}):(\d{2})/);
  if (!match) return 0;
  let hour = parseInt(match[1], 10);
  if (USE_MEXICO_TZ) {
    hour = (hour - 6 + 24) % 24; // UTC a México (UTC-6)
  }
  return hour;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(n);
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log(
    `V1 - Pagos Enero 2025 agrupados por hora (${USE_MEXICO_TZ ? "México UTC-6" : "UTC"})`
  );
  console.log("=".repeat(60));

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

    // Agrupar por hora (0-23)
    const byHour: Record<number, { count: number; monto: number }> = {};
    for (let h = 0; h < 24; h++) {
      byHour[h] = { count: 0, monto: 0 };
    }

    for (const p of allPayments.values()) {
      const hour = getHourFromFechaTransaccion(p.fechaTransaccion);
      byHour[hour].count += 1;
      byHour[hour].monto += p.monto;
    }

    console.log("\nHora (UTC) | Pagos | Monto");
    console.log("-".repeat(45));

    let totalPagos = 0;
    let totalMonto = 0;

    for (let h = 0; h < 24; h++) {
      const { count, monto } = byHour[h];
      totalPagos += count;
      totalMonto += monto;
      const hourStr = h.toString().padStart(2, "0") + ":00";
      console.log(
        `${hourStr}       | ${count.toString().padStart(5)} | ${formatCurrency(monto)}`
      );
    }

    console.log("-".repeat(45));
    console.log(`TOTAL      | ${totalPagos.toString().padStart(5)} | ${formatCurrency(totalMonto)}`);
    console.log("\n" + "=".repeat(60));
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
  }
}

main();
