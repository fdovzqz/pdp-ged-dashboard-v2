export type LogSource = "v1" | "v2" | "payment";

/** Fuente de datos para Análisis Mensual y Anual. */
export type DataSource = "cloudwatch" | "datamapping";

/** Registro de pago. Alineado con schema Convex (paymentRecords); campos opcionales para respuestas API (CloudWatch). */
export interface PaymentRecord {
  referencia: string;
  monto: number;
  timestamp: string;
  fechaTransaccion: string;
  movimiento: string;
  estatus: string;
  tramiteId?: number;
  rawData?: string;
  logSource?: LogSource;
  importMonth?: string;
  importDate?: string;
  /** Campos de respuestas API (CloudWatch); no persistidos en Convex. */
  esDescuento?: boolean;
  serie?: number;
  identificador?: number;
}

export interface PaymentSummary {
  totalPagos: number;
  montoTotal: number;
  porMovimiento: Record<string, number>;
  pagos: PaymentRecord[];
}

export interface QueryResult {
  status: 'Complete' | 'Running' | 'Failed' | 'Cancelled' | 'Timeout' | 'Unknown';
  statistics?: {
    recordsMatched: number;
    recordsScanned: number;
    bytesScanned: number;
  };
  results: PaymentRecord[];
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Contrato unificado de stats por mes para UI espejo (CloudWatch y Datamapping). */
export interface SourceMonthStats {
  month: string;
  totalRecords: number;
  /** Solo datamapping: registros con status PAGO VALIDADO (comparables con paymentRecords). */
  totalRecordsPagoValidado?: number;
  /** Solo datamapping: PAGO VALIDADO con fuente DEC (declaraciones en cero). Número a comparar vs CloudWatch. */
  totalRecordsPagoValidadoDec?: number;
  daysWithData: number;
  lastUpdated: number;
}

/** Detalle de un mes (byDate) para heatmap. Mismo shape para ambas fuentes. byDatePagoValidadoDec solo datamapping (por día, al recalcular). */
export interface SourceMonthDetail {
  totalRecords: number;
  daysWithData: number;
  byDate: Array<{ date: string; count: number }>;
  /** Solo datamapping: por día cuenta PAGO VALIDADO - DEC. Si existe, la tabla diaria muestra DEC y PV−DEC por día. */
  byDatePagoValidadoDec?: Array<{ date: string; count: number }>;
}
