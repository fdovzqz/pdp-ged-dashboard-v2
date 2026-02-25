/**
 * Busca referencias en CloudWatch V2 con la query relajada (sin filtro output!=null).
 * Sirve para verificar que SPEI y similares aparecen en los logs antes de re-sincronizar Convex.
 *
 * Uso: pnpm exec tsx scripts/check-referencias-cloudwatch-v2.ts
 * Requiere .env.local con AWS_* y CLOUDWATCH_LOG_GROUP_V2.
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

const REFERENCIAS = [
  "202600002323148754268",
  "202600002968248834274",
  "202600002823548839291",
  "202600002547848836231",
  "202600002531048837213",
];

/** Feb 2026 días 1-22 en UTC (hora México). */
function feb2026Range(): { startSec: number; endSec: number } {
  const start = Math.floor(
    new Date(Date.UTC(2026, 1, 1, 6, 0, 0, 0)).getTime() / 1000
  );
  const end = Math.floor(
    new Date(Date.UTC(2026, 1, 23, 5, 59, 59, 999)).getTime() / 1000
  );
  return { startSec: start, endSec: end };
}

async function main(): Promise<void> {
  loadEnv();
  const logGroup = process.env.CLOUDWATCH_LOG_GROUP_V2;
  if (!logGroup || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error("Faltan CLOUDWATCH_LOG_GROUP_V2 o credenciales AWS en .env.local");
    process.exit(1);
  }

  const client = new CloudWatchLogsClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const { startSec, endSec } = feb2026Range();
  console.log("Buscando en CloudWatch V2 (Feb 2026, query SIN filtro output!=null)...\n");

  for (const ref of REFERENCIAS) {
    const query = `fields @timestamp, @message
| filter @message like /TaskStateExited/ and @message like /Preparar Datos/
| filter @message like /${ref}/
| limit 10`;

    const startRes = await client.send(
      new StartQueryCommand({
        logGroupName: logGroup,
        startTime: startSec,
        endTime: endSec,
        queryString: query,
      })
    );
    if (!startRes.queryId) {
      console.log(ref, "Error: no queryId");
      continue;
    }

    let status: QueryStatus | undefined = QueryStatus.Running;
    let results: Array<Array<{ field?: string; value?: string }>> = [];
    let attempts = 0;
    while (status === QueryStatus.Running || status === QueryStatus.Scheduled) {
      if (attempts >= 30) break;
      await new Promise((r) => setTimeout(r, 1000));
      const getRes = await client.send(
        new GetQueryResultsCommand({ queryId: startRes.queryId })
      );
      status = getRes.status;
      attempts++;
      if (status === QueryStatus.Complete) {
        results = getRes.results || [];
        break;
      }
    }

    console.log(ref);
    if (results.length === 0) {
      console.log("  No encontrada en V2 (Feb 2026).");
    } else {
      console.log("  Encontrada:", results.length, "evento(s).");
      const first = results[0];
      const rec: Record<string, string> = {};
      for (const f of first) {
        if (f.field && f.value) rec[f.field] = f.value;
      }
      const msg = (rec["@message"] ?? "").substring(0, 200);
      console.log("  @timestamp:", rec["@timestamp"] ?? "-");
      console.log("  @message (inicio):", msg + (msg.length >= 200 ? "..." : ""));
    }
    console.log("");
    await new Promise((r) => setTimeout(r, 800));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
