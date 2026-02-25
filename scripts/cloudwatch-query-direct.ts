/**
 * Ejecuta las mismas queries que convex/cloudwatchActions (conteo por hora y fetch)
 * directo a la API de CloudWatch. Sirve para verificar que el query está bien formado.
 *
 * Uso: pnpm exec tsx scripts/cloudwatch-query-direct.ts 2026-02-16 v2
 *
 * Requiere .env.local: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 * CLOUDWATCH_LOG_GROUP_V1, CLOUDWATCH_LOG_GROUP_V2, CLOUDWATCH_LOG_GROUP_PAYMENT
 */

import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
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

/** Misma lógica que runDeterministicSyncForDate: día México → UTC 06:00–05:59:59 sig. */
function dateToRange(date: string): { startTimeSec: number; endTimeSec: number } {
  const [y, mo, day] = date.split("-").map(Number);
  const startUtc = new Date(Date.UTC(y, mo - 1, day, 6, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, mo - 1, day + 1, 5, 59, 59, 999));
  return {
    startTimeSec: Math.floor(startUtc.getTime() / 1000),
    endTimeSec: Math.floor(endUtc.getTime() / 1000),
  };
}

/** Misma query que getCountByHourQuery en cloudwatchActions.ts */
function getCountByHourQuery(version: "v1" | "v2" | "payment"): string {
  if (version === "payment") {
    return `filter details.parameters like /./
| parse details.parameters '"status":"*"' as status
| filter status like /PAGO VALIDADO/
| stats count() by bin(1h)`;
  }
  if (version === "v2") {
    return `filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| stats count() by bin(1h)`;
  }
  return `filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| stats count() by bin(1h)`;
}

/** Misma query que fetchCloudWatch en cloudwatchActions.ts (fields + filter + limit). */
function getFetchQuery(version: "v1" | "v2" | "payment"): string {
  if (version === "payment") {
    return `fields @timestamp, @message, @logStream, @log
| filter details.parameters like /./
| parse details.parameters '"status":"*"' as status
| parse details.parameters '"tramite":"*"' as tramite
| parse details.parameters '"referencia":"*"' as referencia
| parse details.parameters '"total_pagar":"*"' as monto
| parse details.parameters '"movimiento":"*"' as movimiento
| parse details.parameters '"tipo":"*"' as tipo
| filter status like /PAGO VALIDADO/
| sort @timestamp desc
| limit 10000`;
  }
  if (version === "v2") {
    return `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| sort @timestamp desc
| limit 10000`;
  }
  return `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit 10000`;
}

async function runQuery(
  client: CloudWatchLogsClient,
  logGroup: string,
  startTimeSec: number,
  endTimeSec: number,
  queryString: string,
  label: string
): Promise<Array<Record<string, string>>> {
  console.log(`\n--- ${label} ---`);
  console.log("logGroup:", logGroup.slice(0, 50) + "...");
  console.log("startTimeSec:", startTimeSec, "endTimeSec:", endTimeSec);
  console.log("queryString (primera línea):", queryString.split("\n")[0]);

  const startRes = await client.send(
    new StartQueryCommand({
      logGroupName: logGroup,
      startTime: startTimeSec,
      endTime: endTimeSec,
      queryString,
    })
  );
  if (!startRes.queryId) {
    throw new Error("No queryId");
  }

  let status: QueryStatus | undefined = QueryStatus.Running;
  let attempts = 0;
  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= 90) throw new Error("Query timeout (90s)");
    await new Promise((r) => setTimeout(r, 1000));
    const getRes = await client.send(
      new GetQueryResultsCommand({ queryId: startRes.queryId })
    );
    status = getRes.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      const rows = (getRes.results ?? []).map((row) => {
        const out: Record<string, string> = {};
        for (const f of row) {
          if (f.field && f.value) out[f.field] = f.value;
        }
        return out;
      });
      console.log("Filas devueltas:", rows.length);
      return rows;
    }
  }
  throw new Error(`Query no completó: status=${status}`);
}

async function main(): Promise<void> {
  loadEnv();
  const date = process.argv[2] ?? "2026-02-16";
  const source = (process.argv[3] ?? "v2") as "v1" | "v2" | "payment";

  const logGroupKey = `CLOUDWATCH_LOG_GROUP_${source.toUpperCase()}` as const;
  const logGroup = process.env[logGroupKey];
  if (!logGroup || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error(
      `Faltan ${logGroupKey} o AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY en .env.local`
    );
    process.exit(1);
  }

  const client = new CloudWatchLogsClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const { startTimeSec, endTimeSec } = dateToRange(date);
  console.log("Fecha:", date, "| Fuente:", source);
  console.log("Rango UTC (seg):", startTimeSec, "-", endTimeSec);

  try {
    const countQuery = getCountByHourQuery(source);
    const countRows = await runQuery(
      client,
      logGroup,
      startTimeSec,
      endTimeSec,
      countQuery,
      "QUERY CONTEO (stats count() by bin(1h))"
    );
    console.log("Buckets por hora:", countRows.length);
    for (const row of countRows.slice(0, 5)) {
      console.log("  ", row);
    }
    if (countRows.length > 5) console.log("  ...");

    const fetchQuery = getFetchQuery(source);
    const fetchRows = await runQuery(
      client,
      logGroup,
      startTimeSec,
      endTimeSec,
      fetchQuery,
      "QUERY FETCH (fields @timestamp, @message, ... limit 10000)"
    );
    console.log("Total filas fetch:", fetchRows.length);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
