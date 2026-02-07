export type LogSource = "v1" | "v2" | "payment";

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
