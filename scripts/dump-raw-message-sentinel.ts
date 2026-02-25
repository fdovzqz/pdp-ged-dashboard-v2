/**
 * Descarga un @message crudo de CloudWatch para la primera referencia sentinela
 * y lo escribe en docs/audit/sample-message-sentinel.txt para inspeccionar formato.
 *
 * Uso: pnpm exec tsx scripts/dump-raw-message-sentinel.ts
 */

import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  QueryStatus,
} from "@aws-sdk/client-cloudwatch-logs";
import * as fs from "fs";
import * as path from "path";

const REF = "202600002823548839291";

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
  loadEnv();
  const logGroup = process.env.CLOUDWATCH_LOG_GROUP_V2;
  if (!logGroup || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("Faltan CLOUDWATCH_LOG_GROUP_V2 o credenciales en .env.local");
    process.exit(1);
  }
  const client = new CloudWatchLogsClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const startSec = Math.floor(new Date(Date.UTC(2026, 1, 1, 6, 0, 0, 0)).getTime() / 1000);
  const endSec = Math.floor(new Date(Date.UTC(2026, 1, 23, 5, 59, 59, 999)).getTime() / 1000);
  const query = `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message like /${REF}/
| limit 1`;
  const startRes = await client.send(
    new StartQueryCommand({
      logGroupName: logGroup,
      startTime: startSec,
      endTime: endSec,
      queryString: query,
    })
  );
  if (!startRes.queryId) {
    console.error("No queryId");
    process.exit(1);
  }
  let status: QueryStatus | undefined = QueryStatus.Running;
  let results: Array<Array<{ field?: string; value?: string }>> = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const getRes = await client.send(new GetQueryResultsCommand({ queryId: startRes.queryId }));
    status = getRes.status;
    if (status === QueryStatus.Complete) {
      results = getRes.results || [];
      break;
    }
  }
  const outDir = path.resolve(process.cwd(), "docs", "audit");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "sample-message-sentinel.txt");
  if (results.length === 0) {
    fs.writeFileSync(outPath, "No rows returned from CloudWatch for ref " + REF, "utf-8");
    console.log("No rows. Written", outPath);
    return;
  }
  const row = results[0];
  const rec: Record<string, string> = {};
  for (const f of row) {
    if (f.field && f.value) rec[f.field] = f.value;
  }
  const msg = rec["@message"] ?? "";
  fs.writeFileSync(outPath, `@timestamp: ${rec["@timestamp"] ?? ""}\n\n@message:\n${msg}`, "utf-8");
  console.log("Written", outPath, "(", msg.length, "chars )");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
