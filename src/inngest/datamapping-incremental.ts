"use node";

import { inngest } from "./client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "convex/_generated/api";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

/**
 * Extracción incremental de datamapping desde la marca de agua.
 * Solo se ejecuta al disparar manualmente el evento reconciliation/datamapping.incremental.
 * Para reactivar ejecución cada 5 min, añadir en el array triggers el objeto cron (cada 5 min).
 */
export const datamappingIncremental = inngest.createFunction(
  {
    id: "datamapping-incremental",
    name: "Datamapping: incremental (desde marca de agua)",
    retries: 1,
  },
  [{ event: "reconciliation/datamapping.incremental" }],
  async ({ step }) => {
    const client = new ConvexHttpClient(getConvexUrl());

    const result = await step.run("extraer-incremental", async () => {
      const res = (await client.action(
        api.actions.fetchDatamappingIncremental,
        {}
      )) as {
        inserted: number;
        updated: number;
        processed: number;
        newWatermark: string | null;
        message?: string;
      };
      return res;
    });

    return {
      ok: true,
      processed: result.processed,
      inserted: result.inserted,
      updated: result.updated,
      newWatermark: result.newWatermark,
      message: result.message,
    };
  }
);
