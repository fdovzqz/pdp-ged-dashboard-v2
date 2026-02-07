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

type LogGroupVersion = "v1" | "v2";

const LOG_GROUPS = {
  v1: process.env.CLOUDWATCH_LOG_GROUP_V1!,
  v2: process.env.CLOUDWATCH_LOG_GROUP_V2!,
};

// Query con stats: agrupa por día directamente en CloudWatch
// SOLO cuenta pagos EXITOSOS: TaskStateExited donde output NO es null
// (output != null significa que el trámite se encontró en la DB)
// Parse: importeTxn usando [^0-9]+ para capturar separadores JSON escapados
// Ajuste timezone: -6 horas (21600000ms) para agrupar correctamente por día local
const STATS_BY_DAY_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\\d+)/
| stats count(*) as totalRegistros, sum(importeTxn) as montoTotal by datefloor(@timestamp - 21600000, 24h) + 21600000 as fecha
| sort fecha asc
`;

// Query para obtener conteo por tipo de movimiento
const STATS_BY_MOVIMIENTO_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /movimiento[^A-Z]+(?<movimiento>[A-Z]+)/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\\d+)/
| stats count(*) as total, sum(importeTxn) as monto by movimiento
| sort total desc
`;

export interface DaySummary {
  fecha: string;
  totalRegistros: number;
  montoTotal: number;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const version = (searchParams.get("version") || "v2") as LogGroupVersion;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate y endDate son requeridos" },
        { status: 400 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const logGroup = LOG_GROUPS[version];

    // Ejecutar ambas queries en paralelo
    const [dayQueryStart, movQueryStart] = await Promise.all([
      client.send(new StartQueryCommand({
        logGroupName: logGroup,
        startTime: Math.floor(start.getTime() / 1000),
        endTime: Math.floor(end.getTime() / 1000),
        queryString: STATS_BY_DAY_QUERY,
      })),
      client.send(new StartQueryCommand({
        logGroupName: logGroup,
        startTime: Math.floor(start.getTime() / 1000),
        endTime: Math.floor(end.getTime() / 1000),
        queryString: STATS_BY_MOVIMIENTO_QUERY,
      })),
    ]);

    if (!dayQueryStart.queryId) {
      throw new Error("No se pudo iniciar la query por día");
    }

    // Función helper para esperar resultados de una query
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

    // Esperar ambas queries
    const [dayResults, movResults] = await Promise.all([
      waitForQuery(dayQueryStart.queryId),
      movQueryStart.queryId ? waitForQuery(movQueryStart.queryId, 60) : Promise.resolve({ rawResults: [], statistics: {} }),
    ]);

    const rawResults = dayResults.rawResults;
    const statistics = dayResults.statistics;

    // Parsear resultados del stats
    const byDay: DaySummary[] = rawResults.map((row) => {
      const fechaRaw = row.find((f) => f.field === "fecha")?.value ?? "";
      // datefloor devuelve formato ISO: "2026-01-15 00:00:00.000"
      // Simplemente extraemos los primeros 10 caracteres para YYYY-MM-DD
      const fecha = fechaRaw.substring(0, 10);

      const totalRegistros = parseInt(
        row.find((f) => f.field === "totalRegistros")?.value ?? "0",
        10
      );
      const montoTotal = parseFloat(
        row.find((f) => f.field === "montoTotal")?.value ?? "0"
      );
      return { fecha, totalRegistros, montoTotal };
    });

    let totalPagos = byDay.reduce((sum, d) => sum + d.totalRegistros, 0);
    let montoTotal = byDay.reduce((sum, d) => sum + d.montoTotal, 0);

    // Parsear resultados por tipo de movimiento
    const porMovimiento: Record<string, { total: number; monto: number }> = {};
    movResults.rawResults.forEach((row) => {
      const movimiento = row.find((f) => f.field === "movimiento")?.value ?? "OTRO";
      const total = parseInt(row.find((f) => f.field === "total")?.value ?? "0", 10);
      const monto = parseFloat(row.find((f) => f.field === "monto")?.value ?? "0");
      porMovimiento[movimiento] = { total, monto };
    });

    // Fallback: si 0 resultados pero hay registros escaneados, intentar query más permisiva
    if (byDay.length === 0 && statistics.recordsScanned > 0) {
      const FALLBACK_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| parse @message /importeTxn[^0-9]+(?<importeTxn>\\d+)/
| stats count(*) as totalRegistros, sum(importeTxn) as montoTotal by datefloor(@timestamp - 21600000, 24h) + 21600000 as fecha
| sort fecha asc
`;
      const fallbackStart = await client.send(
        new StartQueryCommand({
          logGroupName: logGroup,
          startTime: Math.floor(start.getTime() / 1000),
          endTime: Math.floor(end.getTime() / 1000),
          queryString: FALLBACK_QUERY,
        })
      );
      if (fallbackStart.queryId) {
        let fbStatus: QueryStatus | undefined = QueryStatus.Running;
        let fbAttempts = 0;
        while (
          (fbStatus === QueryStatus.Running || fbStatus === QueryStatus.Scheduled) &&
          fbAttempts < 60
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          const fbGet = await client.send(
            new GetQueryResultsCommand({ queryId: fallbackStart.queryId })
          );
          fbStatus = fbGet.status;
          fbAttempts++;
          if (fbStatus === QueryStatus.Complete && fbGet.results?.length) {
            const fbByDay = fbGet.results.map((row) => {
              const fechaRaw = row.find((f) => f.field === "fecha")?.value ?? "";
              return {
                fecha: fechaRaw.substring(0, 10),
                totalRegistros: parseInt(
                  row.find((f) => f.field === "totalRegistros")?.value ?? "0",
                  10
                ),
                montoTotal: parseFloat(
                  row.find((f) => f.field === "montoTotal")?.value ?? "0"
                ),
              };
            });
            totalPagos = fbByDay.reduce((s, d) => s + d.totalRegistros, 0);
            montoTotal = fbByDay.reduce((s, d) => s + d.montoTotal, 0);
            return NextResponse.json(
              {
                success: true,
                version,
                logGroup,
                dateRange: { start: start.toISOString(), end: end.toISOString() },
                statistics,
                summary: { totalPagos, montoTotal },
                byDay: fbByDay,
                fallback: true,
              },
              {
                headers: {
                  "Cache-Control": "no-store, no-cache, must-revalidate",
                  Pragma: "no-cache",
                },
              }
            );
          }
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        version,
        logGroup,
        dateRange: { start: start.toISOString(), end: end.toISOString() },
        statistics,
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
    console.error("Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 }
    );
  }
}
