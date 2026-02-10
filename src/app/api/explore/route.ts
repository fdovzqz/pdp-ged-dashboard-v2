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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const version = (searchParams.get("version") || "v2") as LogGroupVersion;
    
    const logGroup = LOG_GROUPS[version];

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate y endDate son requeridos" },
        { status: 400 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Query para ver logs de pagos exitosos (TaskStateExited, output != null)
    const exploreQuery = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit 20
`;


    const startCommand = new StartQueryCommand({
      logGroupName: logGroup,
      startTime: Math.floor(start.getTime() / 1000),
      endTime: Math.floor(end.getTime() / 1000),
      queryString: exploreQuery,
    });

    const startResponse = await client.send(startCommand);
    const queryId = startResponse.queryId;

    if (!queryId) {
      throw new Error("No se pudo iniciar la query");
    }

    let status: QueryStatus | undefined = QueryStatus.Running;
    let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
    let statistics = {};

    const maxAttempts = 30;
    let attempts = 0;

    while (
      status === QueryStatus.Running ||
      status === QueryStatus.Scheduled
    ) {
      if (attempts >= maxAttempts) {
        return NextResponse.json({ error: "Query timeout" }, { status: 500 });
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const getCommand = new GetQueryResultsCommand({ queryId });
      const getResponse = await client.send(getCommand);

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

    // Formatear los resultados para mostrarlos
    const formattedResults = rawResults.map((row) => {
      const result: Record<string, string> = {};
      for (const field of row) {
        if (field.field && field.value) {
          result[field.field] = field.value;
        }
      }
      return result;
    });

    return NextResponse.json({
      success: true,
      version,
      logGroup,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      statistics,
      count: formattedResults.length,
      results: formattedResults,
    });
  } catch (error) {
    console.error("Error exploring logs:", error);
    const searchParams = request.nextUrl.searchParams;
    const version = (searchParams.get("version") || "v2") as LogGroupVersion;
    const logGroup = LOG_GROUPS[version];
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error desconocido",
        version,
        logGroup,
        details: String(error),
      },
      { status: 500 }
    );
  }
}
