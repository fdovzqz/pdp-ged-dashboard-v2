import { NextRequest, NextResponse } from "next/server";
import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import { PaymentRecord } from "@/lib/types";

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
    const txnMonth = searchParams.get("txnMonth") || "2026-01"; // Format: YYYY-MM
    const version = (searchParams.get("version") || "v2") as LogGroupVersion;
    const logStartDate = searchParams.get("logStartDate");
    const logEndDate = searchParams.get("logEndDate");

    const logGroup = LOG_GROUPS[version];

    // Rango de logs: si se especifica logStartDate/logEndDate, usarlo; si no, últimos 90 días
    let start: Date;
    let end: Date;
    if (logStartDate && logEndDate) {
      start = new Date(logStartDate);
      end = new Date(logEndDate);
      end.setHours(23, 59, 59, 999);
    } else {
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - 90);
    }

    // Query that filters by fechaTransaccion month
    // Solo pagos exitosos (TaskStateExited, output != null)
    const query = `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| filter @message like /fechaTransaccion.*${txnMonth}/
| sort @timestamp desc
| limit 10000
`;


    const startCommand = new StartQueryCommand({
      logGroupName: logGroup,
      startTime: Math.floor(start.getTime() / 1000),
      endTime: Math.floor(end.getTime() / 1000),
      queryString: query,
    });

    const startResponse = await client.send(startCommand);
    const queryId = startResponse.queryId;

    if (!queryId) {
      throw new Error("No se pudo iniciar la query");
    }

    let status: QueryStatus | undefined = QueryStatus.Running;
    let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
    let statistics = { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 };

    const maxAttempts = 60;
    let attempts = 0;

    while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
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

    // Parse results - soporta:
    // - V1: details.input con { transacciones: [{referencia, importeTxn, ...}] }
    // - V2: details.input o details.parameters.Payload con { referencia, importeTxn, ... }
    const payments: PaymentRecord[] = [];
    for (const row of rawResults) {
      try {
        const timestampField = row.find((f) => f.field === "@timestamp");
        const messageField = row.find((f) => f.field === "@message");
        if (!messageField?.value) continue;

        const message = JSON.parse(messageField.value);
        let items: Record<string, unknown>[] = [];

        const inputStr = message?.details?.input;
        if (typeof inputStr === "string" && inputStr !== "null") {
          const input = JSON.parse(inputStr) as Record<string, unknown>;
          // V1: batch con transacciones
          const transacciones = input?.transacciones;
          if (Array.isArray(transacciones)) {
            items = transacciones as Record<string, unknown>[];
          } else if (input?.referencia) {
            items = [input];
          }
        } else {
          const paramsStr = message?.details?.parameters;
          if (typeof paramsStr === "string") {
            const params = JSON.parse(paramsStr) as { Payload?: Record<string, unknown> };
            const payload = params?.Payload;
            if (payload?.referencia) items = [payload];
          }
        }

        for (const input of items) {
          if (!input?.referencia) continue;
          const importeTxn = input.importeTxn;
          const monto = typeof importeTxn === "string" ? parseFloat(importeTxn) : Number(importeTxn ?? 0);
          payments.push({
            timestamp: timestampField?.value || "",
            referencia: String(input.referencia ?? ""),
            monto,
            tramiteId: input.tramiteId != null ? Number(input.tramiteId) : undefined,
            movimiento: String(input.movimiento ?? ""),
            fechaTransaccion: String(input.fechaTransaccion ?? ""),
            estatus: String(input.estatus ?? ""),
            esDescuento: Boolean(input.esDescuento ?? false),
            serie: Number(input.serie ?? 0),
            identificador: Number(input.identificador ?? 0),
          });
        }
      } catch {
        continue;
      }
    }

    // Deduplicate
    let uniquePayments = payments.reduce((acc, current) => {
      if (!acc.find((p) => p.referencia === current.referencia)) {
        acc.push(current);
      }
      return acc;
    }, [] as PaymentRecord[]);

    // Filtrar por mes: solo incluir pagos cuya fechaTransaccion empiece con txnMonth (YYYY-MM)
    uniquePayments = uniquePayments.filter(
      (p) => p.fechaTransaccion && p.fechaTransaccion.startsWith(txnMonth)
    );

    // Calculate summary
    const porMovimiento: Record<string, number> = {};
    for (const p of uniquePayments) {
      porMovimiento[p.movimiento] = (porMovimiento[p.movimiento] || 0) + 1;
    }

    return NextResponse.json(
      {
        success: true,
        version,
        logGroup,
        txnMonth,
        statistics,
        summary: {
          totalPagos: uniquePayments.length,
          montoTotal: uniquePayments.reduce((sum, p) => sum + p.monto, 0),
          porMovimiento,
        },
        pagos: uniquePayments,
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
