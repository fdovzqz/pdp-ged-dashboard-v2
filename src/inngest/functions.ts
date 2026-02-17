import { inngest } from "./client";

/**
 * Función de prueba para verificar que Inngest está conectado.
 * Se dispara con el evento "reconciliation/test.ping".
 * Puedes invocarla desde el Inngest Dev Server o desde GET /api/test-inngest.
 */
export const testPing = inngest.createFunction(
  {
    id: "test-ping",
    name: "Test Ping (conexión Inngest)",
    retries: 0,
  },
  { event: "reconciliation/test.ping" },
  async ({ event }) => {
    const message = `Ping recibido a las ${new Date().toISOString()}. Data: ${JSON.stringify(event.data ?? {})}`;
    console.log("[Inngest] test-ping:", message);
    return {
      ok: true,
      message,
      at: new Date().toISOString(),
    };
  }
);
