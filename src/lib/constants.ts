/** Año del análisis de enero (dashboard principal). */
export const ANALYSIS_YEAR = 2026;

/** Mes del análisis (1 = Enero). */
export const ANALYSIS_MONTH = 1;

/** Mes en formato YYYY-MM para queries. */
export const ANALYSIS_MONTH_STRING = "2026-01";

/** Etiqueta legible del período (ej. "Enero 2026"). */
export const ANALYSIS_MONTH_LABEL = "Enero 2026";

/** Nombre del archivo PDF exportado. */
export const PDF_FILENAME = "analisis-enero-2026.pdf";

/** Título del PDF exportado. */
export const PDF_TITLE = "Análisis de Enero 2026";

/** Inicio del período disponible para extracción CloudWatch (enero 2024). */
export const PERIOD_START = "2024-01";

/** Fin del período disponible para extracción CloudWatch (febrero 2026). */
export const PERIOD_END = "2026-02";

/** Fecha inicial del período (formato YYYY-MM-DD). */
export const PERIOD_START_DATE = "2024-01-01";

/** Fecha final del período (último día de feb 2026). */
export const PERIOD_END_DATE = "2026-02-28";

/** Genera array de fechas YYYY-MM-DD entre start y end inclusive. */
export function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const current = new Date(sy, sm - 1, sd);
  const endDate = new Date(ey, em - 1, ed);
  while (current <= endDate) {
    dates.push(
      `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`
    );
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Genera array de todos los meses YYYY-MM entre start y end inclusive. */
export function generateMonthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}
