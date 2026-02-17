import { Inngest } from "inngest";

/**
 * Cliente Inngest para enviar eventos y registrar funciones.
 * Usado por la ruta /api/inngest y por cualquier código que dispare jobs.
 */
export const inngest = new Inngest({
  id: "reconciliation",
  name: "Reconciliación de pagos",
});
