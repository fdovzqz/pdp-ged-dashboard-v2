import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import { PaymentRecord, QueryResult } from "./types";

const client = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const LOG_GROUPS = {
  v1: process.env.CLOUDWATCH_LOG_GROUP_V1!,
  v2: process.env.CLOUDWATCH_LOG_GROUP_V2!,
  payment: process.env.CLOUDWATCH_LOG_GROUP_PAYMENT!,
} as const;

export type LogGroupVersion = "v1" | "v2" | "payment";

export function getLogGroup(version: LogGroupVersion): string {
  return LOG_GROUPS[version];
}

// Query para extraer todos los pagos con detalles completos
const PAYMENTS_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateEntered/ and @message like /"name":\\s*"Preparar Datos"/
| parse @message /"input":\\s*"(?<inputRaw>[^"]*(?:\\\\"[^"]*)*)"/ 
| display @timestamp, inputRaw
| sort @timestamp asc
| limit 10000
`;

// Query alternativa más simple
const SIMPLE_QUERY = `
fields @timestamp, @message
| filter @message like /Preparar Datos/ and @message like /TaskStateEntered/
| filter @message like /"referencia"/
| sort @timestamp desc
| limit 10000
`;

// Query para pagos con fecha de transacción en enero 2026
const JANUARY_2026_QUERY = `
fields @timestamp, @message
| filter @message like /Preparar Datos/ and @message like /TaskStateEntered/
| filter @message like /2026-01/
| sort @timestamp desc
| limit 10000
`;

// Query para obtener conteo por referencia única
const COUNT_QUERY = `
fields @timestamp, @message
| filter @message like /TaskStateEntered/ and @message like /"name":\s*"Preparar Datos"/
| parse @message /"referencia":\s*"(?<referencia>[^"]+)"/
| stats count(*) as veces by referencia
| sort veces desc
| limit 10000
`;

// Query para explorar la estructura de los logs
const EXPLORE_QUERY = `
fields @timestamp, @message
| sort @timestamp desc
| limit 50
`;

export async function queryPayments(
  startTime: Date,
  endTime: Date,
  version: LogGroupVersion = "v2"
): Promise<QueryResult> {
  try {
    const logGroup = getLogGroup(version);
    
    // Iniciar la query
    const startCommand = new StartQueryCommand({
      logGroupName: logGroup,
      startTime: Math.floor(startTime.getTime() / 1000),
      endTime: Math.floor(endTime.getTime() / 1000),
      queryString: SIMPLE_QUERY,
    });

    const startResponse = await client.send(startCommand);
    const queryId = startResponse.queryId;

    if (!queryId) {
      throw new Error("No se pudo iniciar la query");
    }

    // Esperar resultados (polling)
    let status: QueryStatus | undefined = QueryStatus.Running;
    const results: QueryResult = {
      status: "Running",
      results: [],
    };

    const maxAttempts = 30;
    let attempts = 0;

    while (
      status === QueryStatus.Running ||
      status === QueryStatus.Scheduled
    ) {
      if (attempts >= maxAttempts) {
        results.status = "Timeout";
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const getCommand = new GetQueryResultsCommand({ queryId });
      const getResponse = await client.send(getCommand);

      status = getResponse.status;
      attempts++;

      if (status === QueryStatus.Complete) {
        results.status = "Complete";
        results.statistics = {
          recordsMatched: getResponse.statistics?.recordsMatched ?? 0,
          recordsScanned: getResponse.statistics?.recordsScanned ?? 0,
          bytesScanned: getResponse.statistics?.bytesScanned ?? 0,
        };

        // Parsear los resultados
        results.results = parseQueryResults(getResponse.results || []);
      } else if (status === QueryStatus.Failed) {
        results.status = "Failed";
      } else if (status === QueryStatus.Cancelled) {
        results.status = "Cancelled";
      }
    }

    return results;
  } catch (error) {
    console.error("Error querying CloudWatch:", error);
    throw error;
  }
}

function parseQueryResults(
  rawResults: Array<Array<{ field?: string; value?: string }>>
): PaymentRecord[] {
  const payments: PaymentRecord[] = [];

  for (const row of rawResults) {
    try {
      const timestampField = row.find((f) => f.field === "@timestamp");
      const messageField = row.find((f) => f.field === "@message");

      if (!messageField?.value) continue;

      // El mensaje es un JSON, parsearlo
      const message = JSON.parse(messageField.value);
      
      // En CloudWatch, la estructura es directa: message.details.input
      // No hay @message anidado como en el JSON exportado
      const inputStr = message?.details?.input;
      if (!inputStr) continue;

      // Parsear el input que contiene los datos del pago
      const input = JSON.parse(inputStr);

      // Verificar que tenga los campos de pago
      if (!input.referencia) continue;

      // importeTxn = monto total de la transacción (en pesos).
      const payment: PaymentRecord = {
        timestamp: timestampField?.value || "",
        referencia: input.referencia || "",
        monto: input.importeTxn ?? 0,
        tramiteId: input.tramiteId ? Number(input.tramiteId) : undefined,
        movimiento: input.movimiento || "",
        fechaTransaccion: input.fechaTransaccion || "",
        estatus: input.estatus || "",
        esDescuento: input.esDescuento ?? false,
        serie: input.serie ?? 0,
        identificador: input.identificador ?? 0,
      };

      payments.push(payment);
    } catch {
      // Skip malformed records
      continue;
    }
  }

  // Eliminar duplicados por referencia (puede haber múltiples eventos del mismo pago)
  const uniquePayments = payments.reduce((acc, current) => {
    const exists = acc.find(p => p.referencia === current.referencia);
    if (!exists) {
      acc.push(current);
    }
    return acc;
  }, [] as PaymentRecord[]);

  return uniquePayments;
}

export function calculateSummary(payments: PaymentRecord[]) {
  const porMovimiento: Record<string, number> = {};

  for (const payment of payments) {
    porMovimiento[payment.movimiento] =
      (porMovimiento[payment.movimiento] || 0) + 1;
  }

  return {
    totalPagos: payments.length,
    montoTotal: payments.reduce((sum, p) => sum + p.monto, 0),
    porMovimiento,
    pagos: payments,
  };
}
