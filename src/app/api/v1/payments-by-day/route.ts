import { NextRequest, NextResponse } from "next/server";
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";

const client = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const LOG_GROUP_V1 = process.env.CLOUDWATCH_LOG_GROUP_V1!;

// Primero: Query exploratoria para entender la estructura de V1
const EXPLORE_V1_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| sort @timestamp desc
| limit 5
`;

// Query para contar por tipo de output (null vs datos)
const COUNT_BY_OUTPUT_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| stats 
    count(*) as total,
    sum(strcontains(@message, '"output":"null"')) as noEncontrados,
    sum(strcontains(@message, '"output":"{\\"')) as encontrados
`;

// Query principal: Pagos exitosos V1 por día
// Ajustar según la estructura real de V1
const STATS_BY_DAY_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\\d+)/
| stats count(*) as totalRegistros, sum(importeTxn) as montoTotal by datefloor(@timestamp - 21600000, 24h) + 21600000 as fecha
| sort fecha asc
`;

// Query por tipo de movimiento V1
const STATS_BY_MOVIMIENTO_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /movimiento[^A-Z]+(?<movimiento>[A-Z]+)/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\\d+)/
| stats count(*) as total, sum(importeTxn) as monto by movimiento
| sort total desc
`;

interface DaySummary {
  fecha: string;
  totalRegistros: number;
  montoTotal: number;
}

async function waitForQuery(queryId: string, maxAttempts = 120) {
  let status: QueryStatus | undefined = QueryStatus.Running;
  let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
  let statistics = { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 };
  let attempts = 0;

  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= maxAttempts) {
      throw new Error("Query timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const getResponse = await client.send(new GetQueryResultsCommand({ queryId }));
    status = getResponse.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      rawResults = getResponse.results || [];
      statistics = {
        recordsMatched: getResponse.statistics?.recordsMatched ?? 0,
        recordsScanned: getResponse.statistics?.recordsScanned ?? 0,
        bytesScanned: getResponse.statistics?.bytesScanned ?? 0,
      };
    }
  }
  return { rawResults, statistics };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const mode = searchParams.get("mode") || "stats"; // stats, explore, count

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate y endDate son requeridos" },
        { status: 400 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);


    // Modo explorar: ver estructura de logs
    if (mode === "explore") {
      const exploreStart = await client.send(new StartQueryCommand({
        logGroupName: LOG_GROUP_V1,
        startTime: Math.floor(start.getTime() / 1000),
        endTime: Math.floor(end.getTime() / 1000),
        queryString: EXPLORE_V1_QUERY,
      }));

      if (!exploreStart.queryId) throw new Error("No se pudo iniciar query");
      const { rawResults, statistics } = await waitForQuery(exploreStart.queryId);

      const samples = rawResults.map((row) => {
        const message = row.find((f) => f.field === "@message")?.value ?? "";
        return {
          timestamp: row.find((f) => f.field === "@timestamp")?.value ?? "",
          message,
          parsed: message ? JSON.parse(message) : null,
        };
      });

      return NextResponse.json({
        success: true,
        mode: "explore",
        logGroup: LOG_GROUP_V1,
        statistics,
        samples,
      });
    }

    // Modo count: ver distribución exitosos vs no encontrados
    if (mode === "count") {
      const countStart = await client.send(new StartQueryCommand({
        logGroupName: LOG_GROUP_V1,
        startTime: Math.floor(start.getTime() / 1000),
        endTime: Math.floor(end.getTime() / 1000),
        queryString: COUNT_BY_OUTPUT_QUERY,
      }));

      if (!countStart.queryId) throw new Error("No se pudo iniciar query");
      const { rawResults, statistics } = await waitForQuery(countStart.queryId);

      const row = rawResults[0] || [];
      const counts = {
        total: parseInt(row.find((f) => f.field === "total")?.value ?? "0", 10),
        noEncontrados: parseInt(row.find((f) => f.field === "noEncontrados")?.value ?? "0", 10),
        encontrados: parseInt(row.find((f) => f.field === "encontrados")?.value ?? "0", 10),
      };

      return NextResponse.json({
        success: true,
        mode: "count",
        logGroup: LOG_GROUP_V1,
        statistics,
        counts,
      });
    }

    // Modo stats (default): estadísticas por día
    const [dayQueryStart, movQueryStart] = await Promise.all([
      client.send(new StartQueryCommand({
        logGroupName: LOG_GROUP_V1,
        startTime: Math.floor(start.getTime() / 1000),
        endTime: Math.floor(end.getTime() / 1000),
        queryString: STATS_BY_DAY_QUERY,
      })),
      client.send(new StartQueryCommand({
        logGroupName: LOG_GROUP_V1,
        startTime: Math.floor(start.getTime() / 1000),
        endTime: Math.floor(end.getTime() / 1000),
        queryString: STATS_BY_MOVIMIENTO_QUERY,
      })),
    ]);

    if (!dayQueryStart.queryId) throw new Error("No se pudo iniciar query");

    const [dayResults, movResults] = await Promise.all([
      waitForQuery(dayQueryStart.queryId),
      movQueryStart.queryId ? waitForQuery(movQueryStart.queryId, 60) : Promise.resolve({ rawResults: [], statistics: {} }),
    ]);

    // Parsear resultados por día
    const byDay: DaySummary[] = dayResults.rawResults.map((row) => {
      const fechaRaw = row.find((f) => f.field === "fecha")?.value ?? "";
      return {
        fecha: fechaRaw.substring(0, 10),
        totalRegistros: parseInt(row.find((f) => f.field === "totalRegistros")?.value ?? "0", 10),
        montoTotal: parseFloat(row.find((f) => f.field === "montoTotal")?.value ?? "0"),
      };
    });

    // Parsear resultados por movimiento
    const porMovimiento: Record<string, { total: number; monto: number }> = {};
    movResults.rawResults.forEach((row) => {
      const movimiento = row.find((f) => f.field === "movimiento")?.value ?? "OTRO";
      const total = parseInt(row.find((f) => f.field === "total")?.value ?? "0", 10);
      const monto = parseFloat(row.find((f) => f.field === "monto")?.value ?? "0");
      porMovimiento[movimiento] = { total, monto };
    });

    const totalPagos = byDay.reduce((sum, d) => sum + d.totalRegistros, 0);
    const montoTotal = byDay.reduce((sum, d) => sum + d.montoTotal, 0);

    return NextResponse.json(
      {
        success: true,
        mode: "stats",
        logGroup: LOG_GROUP_V1,
        dateRange: { start: start.toISOString(), end: end.toISOString() },
        statistics: dayResults.statistics,
        summary: {
          totalPagos,
          montoTotal,
          porMovimiento,
        },
        byDay,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("Error V1:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
