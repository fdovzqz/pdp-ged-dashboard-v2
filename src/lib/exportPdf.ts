import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

export interface ExportPdfOptions {
  elementId: string;
  filename?: string;
  title?: string;
  financialSummary?: {
    totalAmount: number;
    ticketPromedio: number;
  };
}

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);

export async function exportDashboardToPdf(
  options: ExportPdfOptions
): Promise<void> {
  const {
    elementId,
    filename = "dashboard-enero.pdf",
    title = "Análisis de Enero",
    financialSummary,
  } = options;

  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Elemento #${elementId} no encontrado`);
  }

  const dataUrl = await toPng(element, {
    quality: 1,
    pixelRatio: 2,
    backgroundColor: "#020617",
  });

  const pdf = new jsPDF("p", "mm", "a4");
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;

  pdf.setFontSize(18);
  pdf.text(title, margin, 15);
  pdf.setFontSize(10);
  pdf.text(
    `Generado: ${new Date().toLocaleString("es-MX")}`,
    margin,
    22
  );

  if (financialSummary) {
    pdf.setFontSize(12);
    pdf.text("Resumen financiero", margin, 32);
    pdf.setFontSize(10);
    pdf.text(
      `Ingreso total: ${formatCurrency(financialSummary.totalAmount)}`,
      margin,
      40
    );
    pdf.text(
      `Ticket promedio: ${formatCurrency(financialSummary.ticketPromedio)}`,
      margin,
      47
    );
  }

  const imgWidth = pdfWidth - 2 * margin;
  const imgHeight = (element.offsetHeight / element.offsetWidth) * imgWidth;
  const startY = financialSummary ? 55 : 30;

  pdf.addImage(dataUrl, "PNG", margin, startY, imgWidth, Math.min(imgHeight, pdfHeight - startY - margin));

  pdf.save(filename);
}
