/**
 * Obtiene pagos V1 y V2 de Enero 2026 agrupados por hora (fechaTransaccion).
 * Deduplicados por referencia.
 *
 * Requiere: dashboard corriendo en http://localhost:3000
 *
 * Uso: npx tsx scripts/fetch-v1-v2-january-2026-by-hour.ts
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

type Version = "v1" | "v2";

async function fetchByTxnDate(
  txnMonth: string,
  logStartDate: string,
  logEndDate: string,
  version: Version
): Promise<TxnDateResponse> {
  const url = `${BASE_URL}/payments-by-txn-date?txnMonth=${txnMonth}&version=${version}&logStartDate=${logStartDate}&logEndDate=${logEndDate}`;
  const res = await fetch(url);
  const data = (await res.json()) as TxnDateResponse;
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

/** Hora en zona México (UTC-6) por defecto. */
const USE_MEXICO_TZ = true;

function getHourFromFechaTransaccion(fecha: string): number {
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

function buildByHourMap(payments: Map<string, PaymentRecord>): Record<number, { count: number; monto: number }> {
  const byHour: Record<number, { count: number; monto: number }> = {};
  for (let h = 0; h < 24; h++) {
    byHour[h] = { count: 0, monto: 0 };
  }
  for (const p of payments.values()) {
    const hour = getHourFromFechaTransaccion(p.fechaTransaccion);
    byHour[hour].count += 1;
    byHour[hour].monto += p.monto;
  }
  return byHour;
}

function printByHourTable(
  byHour: Record<number, { count: number; monto: number }>,
  label: string
): void {
  console.log(`\n--- ${label} ---`);
  console.log("Hora       | Pagos | Monto");
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
}

async function fetchPaymentsForVersion(
  txnMonth: string,
  ranges: Array<{ start: string; end: string }>,
  version: Version
): Promise<Map<string, PaymentRecord>> {
  const allPayments = new Map<string, PaymentRecord>();

  for (const range of ranges) {
    try {
      const data = await fetchByTxnDate(txnMonth, range.start, range.end, version);
      if (!data.success || !data.pagos) continue;
      for (const p of data.pagos) {
        if (!allPayments.has(p.referencia)) {
          allPayments.set(p.referencia, p);
        }
      }
    } catch (err) {
      console.warn(`  [${version.toUpperCase()}] Error en ${range.start}-${range.end}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return allPayments;
}

async function main(): Promise<void> {
  const txnMonth = "2026-01";
  const tzLabel = USE_MEXICO_TZ ? "México UTC-6" : "UTC";

  console.log("=".repeat(60));
  console.log(`V1 y V2 - Pagos Enero 2026 agrupados por hora (${tzLabel})`);
  console.log("=".repeat(60));

  const ranges = [
    { start: "2026-01-01", end: "2026-01-05" },
    { start: "2026-01-06", end: "2026-01-10" },
    { start: "2026-01-11", end: "2026-01-15" },
    { start: "2026-01-16", end: "2026-01-20" },
    { start: "2026-01-21", end: "2026-01-25" },
    { start: "2026-01-26", end: "2026-01-31" },
  ];

  try {
    const [v1Payments, v2Payments] = await Promise.all([
      fetchPaymentsForVersion(txnMonth, ranges, "v1"),
      fetchPaymentsForVersion(txnMonth, ranges, "v2"),
    ]);

    const v1ByHour = buildByHourMap(v1Payments);
    const v2ByHour = buildByHourMap(v2Payments);

    printByHourTable(v1ByHour, "V1");
    printByHourTable(v2ByHour, "V2");

    // Tabla combinada (V1 + V2, referencias únicas entre ambos)
    const combined = new Map<string, PaymentRecord>();
    for (const p of v1Payments.values()) combined.set(p.referencia, p);
    for (const p of v2Payments.values()) {
      if (!combined.has(p.referencia)) combined.set(p.referencia, p);
    }
    const combinedByHour = buildByHourMap(combined);
    printByHourTable(combinedByHour, "V1 + V2 (referencias únicas)");

    console.log("\n" + "=".repeat(60));
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
  }
}

main();
