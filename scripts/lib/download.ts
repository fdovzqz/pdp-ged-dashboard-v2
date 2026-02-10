/**
 * Shared CloudWatch download logic for log retrieval.
 */

import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import * as fs from "fs";
import * as path from "path";

const LOG_GROUPS = {
  v1: process.env.CLOUDWATCH_LOG_GROUP_V1!,
  v2: process.env.CLOUDWATCH_LOG_GROUP_V2!,
  payment: process.env.CLOUDWATCH_LOG_GROUP_PAYMENT!,
} as const;

export type LogVersion = keyof typeof LOG_GROUPS;

const client = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export function loadEnvFromDashboard(): void {
  const paths = [path.resolve(process.cwd(), ".env.local")];
  for (const envPath of paths) {
    if (fs.existsSync(envPath)) {
      parseEnvFile(envPath);
      return;
    }
  }
}

function parseEnvFile(envPath: string): void {
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

export async function downloadLogs(
  version: LogVersion,
  startTime: number,
  endTime: number,
  limit = 10000
): Promise<Array<Record<string, string>>> {
  const logGroup = LOG_GROUPS[version];
  const query =
    version === "payment"
      ? `
fields @timestamp, @message
| sort @timestamp desc
| limit ${limit}
`
      : `
fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message not like /"output":"null"/
| sort @timestamp desc
| limit ${limit}
`;

  const startCmd = new StartQueryCommand({
    logGroupName: logGroup,
    startTime,
    endTime,
    queryString: query,
  });
  const startRes = await client.send(startCmd);
  const queryId = startRes.queryId;
  if (!queryId) throw new Error("No queryId");

  let status: QueryStatus | undefined = QueryStatus.Running;
  let rawResults: Array<Array<{ field?: string; value?: string }>> = [];
  let attempts = 0;

  while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
    if (attempts >= 120) throw new Error("Query timeout");
    await new Promise((r) => setTimeout(r, 1000));
    const getRes = await client.send(new GetQueryResultsCommand({ queryId }));
    status = getRes.status;
    attempts++;
    if (status === QueryStatus.Complete) {
      rawResults = getRes.results || [];
      break;
    }
  }

  return rawResults.map((row) => {
    const result: Record<string, string> = {};
    for (const f of row) {
      if (f.field && f.value) result[f.field] = f.value;
    }
    return result;
  });
}
