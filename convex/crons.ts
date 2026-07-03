import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Actualización nocturna de datos: 08:30 UTC = 02:30 hora de México (UTC-6).
 * Cadena completa en convex/nightlyUpdate.ts; runbook en docs/runbook-actualizacion-datos.md.
 */
crons.daily(
  "actualizacion-nocturna-datos",
  { hourUTC: 8, minuteUTC: 30 },
  internal.nightlyUpdate.start
);

export default crons;
