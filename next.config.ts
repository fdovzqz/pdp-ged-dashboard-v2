import type { NextConfig } from "next";
import path from "path";
import fs from "fs";

const envPath = path.resolve(process.cwd(), ".env.local");

let convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("NEXT_PUBLIC_CONVEX_URL=")) {
      const val = trimmed.slice("NEXT_PUBLIC_CONVEX_URL=".length).trim().replace(/^["']|["']$/g, "");
      if (val && val.startsWith("http")) {
        convexUrl = val;
      }
      break;
    }
  }
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  async redirects() {
    return [
      { source: "/upload", destination: "/configuracion/datos", permanent: true },
      { source: "/jobs", destination: "/configuracion/status", permanent: true },
      { source: "/reconcile/january-2026", destination: "/reconciliacion/diferencias-fuentes", permanent: true },
      { source: "/reconcile/rfc-referencias", destination: "/reconciliacion/consultas-referencia-rfc-placa", permanent: true },
    ];
  },
  ...(convexUrl && {
    env: {
      NEXT_PUBLIC_CONVEX_URL: convexUrl,
    },
  }),
};

export default nextConfig;
