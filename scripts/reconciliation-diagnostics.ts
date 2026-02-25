/**
 * Diagnóstico de diferencias POR MES entre paymentRecords (CloudWatch) y datamappingRecords (DynamoDB).
 *
 * 1) Query (solo tablas guardadas, lo que muestra la UI):
 *    npx tsx scripts/reconciliation-diagnostics.ts
 *
 * 2) Action (incluye conteo por fechaTransaccion; tarda más):
 *    pnpm exec convex run reconciliationActions:getReconciliationDiagnosticsByMonth
 *
 * Si diferenciaByFechaTransaccion ~0 pero diferenciaByUpdatedAt no, la diferencia en la UI
 * es por criterio de mes: paymentRecords = mes del pago, datamappingMonthStats = por updatedAt.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as fs from "fs";
import * as path from "path";

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const idx = trimmed.indexOf("=");
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          process.env[key] = val;
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const monthsArg = process.argv.slice(2);
  loadEnv();
  const convexUrl =
    process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL o NEXT_PUBLIC_CONVEX_URL requerido en .env.local");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);

  const table = (await client.query(
    api.reconciliationQueries.getReconciliationDiagnosticsTable,
    monthsArg.length ? { months: monthsArg } : {}
  )) as Array<{
    month: string;
    paymentRecords: number;
    datamappingByUpdatedAt: {
      totalRecords: number;
      pagoValidado: number;
      pagoValidadoDec: number;
      pvMenosDec: number;
    };
    diferencia: number;
  }>;

  console.log("\n--- Diagnóstico por mes (desde tablas Convex, mismo criterio que la UI) ---\n");
  console.log(
    "Mes        | paymentRecords | DDB total | DDB PV   | DDB DEC  | PV−DEC   | Diferencia"
  );
  console.log(
    "-----------|----------------|-----------|----------|----------|----------|------------"
  );
  for (const row of table) {
    const dm = row.datamappingByUpdatedAt;
    console.log(
      `${row.month}   | ${String(row.paymentRecords).padStart(14)} | ${String(dm.totalRecords).padStart(9)} | ${String(dm.pagoValidado).padStart(8)} | ${String(dm.pagoValidadoDec).padStart(8)} | ${String(dm.pvMenosDec).padStart(8)} | ${row.diferencia >= 0 ? "+" : ""}${row.diferencia}`
    );
  }
  const sumDiff = table.reduce((s, r) => s + r.diferencia, 0);
  console.log("-----------|----------------|-----------|----------|----------|----------|------------");
  console.log(`Suma diferencias: ${sumDiff >= 0 ? "+" : ""}${sumDiff}`);
  console.log("\nPara ver el mismo conteo pero agrupando datamapping por FECHA TRANSACCIÓN (mes del pago), ejecuta:");
  console.log("  pnpm exec convex run reconciliationActions:getReconciliationDiagnosticsByMonth");
  console.log("Si ahí la diferencia por mes es ~0, la discrepancia actual es por comparar 'mes del pago' (CW) vs 'mes updatedAt' (DDB).\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
