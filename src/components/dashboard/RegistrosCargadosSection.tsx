"use client";

import { motion } from "framer-motion";
import { IngestionStatus } from "./IngestionStatus";
import { PERIOD_START, PERIOD_END, generateMonthRange } from "@/lib/constants";
import type { SourceMonthStats, SourceMonthDetail } from "@/lib/types";

export type { SourceMonthStats, SourceMonthDetail };

/** Stats guardadas de datamapping (total, PAGO VALIDADO, PAGO VALIDADO-DEC). Comparación: CloudWatch vs totalPagoValidadoDec. */
export interface DatamappingSavedStats {
  total: number;
  totalPagoValidado?: number;
  totalPagoValidadoDec?: number;
  byYear: Array<{ year: string; count: number }>;
  byYearPagoValidado?: Array<{ year: string; count: number }>;
  byYearPagoValidadoDec?: Array<{ year: string; count: number }>;
  byMonth: Array<{ month: string; count: number }>;
  byMonthPagoValidado?: Array<{ month: string; count: number }>;
  byMonthPagoValidadoDec?: Array<{ month: string; count: number }>;
  byDay?: Array<{ date: string; count: number }>;
  byDayPagoValidado?: Array<{ date: string; count: number }>;
  byDayPagoValidadoDec?: Array<{ date: string; count: number }>;
  lastUpdated?: number;
}

interface RegistrosCargadosSectionProps {
  /** paymentRecords (CloudWatch): lista por mes, mismo contrato que datamappingMonths. */
  cloudwatchMonths: SourceMonthStats[] | undefined;
  /** datamappingRecords (DynamoDB): lista por mes, mismo contrato que cloudwatchMonths. */
  datamappingMonths: SourceMonthStats[] | undefined;
  /** Stats guardadas (total, totalPagoValidado, byYear, byYearPagoValidado). Si no se pasa, se deriva de datamappingMonths (sin PAGO VALIDADO). */
  datamappingSavedStats?: DatamappingSavedStats | null;
  selectedMonth: string | null;
  onMonthSelect: (month: string | null) => void;
  /** Detalle del mes seleccionado (byDate) para CloudWatch. */
  cloudwatchMonthDetail: SourceMonthDetail | undefined;
  /** Auditoría de ingestión CloudWatch por día: días con posible truncamiento (límite 10k por ventana). */
  cloudwatchAudit?: Array<{ date: string; truncationRisk: boolean }> | undefined;
  /** Detalle del mes seleccionado (byDate) para Datamapping. */
  datamappingMonthDetail: SourceMonthDetail | undefined;
  datamappingStatsLoading: boolean;
  onRefreshDatamapping?: () => void;
  onRefreshPaymentRecords?: () => void;
  paymentRecordsRecalcLoading?: boolean;
}

/** Formato de diferencia paymentRecords − datamappingRecords (PAGO VALIDADO): con signo y color. */
function formatDiff(diff: number): { text: string; className: string } {
  if (diff === 0) return { text: "0", className: "text-muted-foreground" };
  if (diff > 0) return { text: `+${diff.toLocaleString()}`, className: "text-indigo-300" };
  return { text: diff.toLocaleString(), className: "text-amber-300" };
}

/** Resumen: paymentRecords, datamappingRecords (Total, PAGO VALIDADO, PAGO VALIDADO - DEC). Diferencia = CW − (PAGO VALIDADO − PAGO VALIDADO DEC). */
function TotalesRow({
  cwTotal,
  ddbTotal,
  ddbPagoValidado,
  ddbPagoValidadoDec,
  loading,
}: {
  cwTotal: number;
  ddbTotal: number | null;
  ddbPagoValidado: number | null | undefined;
  /** PAGO VALIDADO con fuente DEC (declaraciones en cero). Valor a restar de PAGO VALIDADO para comparar vs CloudWatch. */
  ddbPagoValidadoDec: number | null | undefined;
  loading: boolean;
}): React.ReactElement {
  const pagoValidadoMenosDec =
    ddbPagoValidado != null || ddbPagoValidadoDec != null
      ? (ddbPagoValidado ?? 0) - (ddbPagoValidadoDec ?? 0)
      : (ddbTotal ?? 0);
  const diff = loading ? null : cwTotal - pagoValidadoMenosDec;
  const { text: diffText, className: diffClass } = formatDiff(diff ?? 0);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center rounded-xl p-4 bg-slate-800/50 border border-slate-700/50">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          paymentRecords
        </p>
        <p className="text-lg font-bold tabular-nums text-indigo-300">{cwTotal.toLocaleString()}</p>
      </div>
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          datamappingRecords
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          <div className="text-lg font-bold tabular-nums text-amber-300">
            <span>{(ddbTotal ?? 0).toLocaleString()}</span>
            {ddbPagoValidado != null && (
              <span className="block text-xs font-normal text-amber-200/80">
                PAGO VALIDADO: {ddbPagoValidado.toLocaleString()}
              </span>
            )}
            {ddbPagoValidadoDec != null && (
              <span className="block text-xs font-normal text-amber-200/70">
                PAGO VALIDADO - DEC: {ddbPagoValidadoDec.toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          DataMapping (PV − DEC)
        </p>
        <p className="text-lg font-bold tabular-nums text-amber-200/90">
          {loading ? "…" : pagoValidadoMenosDec.toLocaleString()}
        </p>
        <p className="text-[10px] text-muted-foreground">comparación con paymentRecords</p>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Diferencia (CW − (PAGO VALIDADO − DEC))
        </p>
        <p className={`text-lg font-bold tabular-nums ${loading ? "text-muted-foreground" : diffClass}`}>
          {loading ? "…" : diffText}
        </p>
      </div>
    </div>
  );
}

/** Por año: datamapping (Total / PAGO VALIDADO / PAGO VALIDADO - DEC). Diferencia = CW − (PAGO VALIDADO − PAGO VALIDADO DEC). */
function PorAnioTable({
  cwByYear,
  ddbByYear,
  ddbByYearPagoValidado,
  ddbByYearPagoValidadoDec,
  loading,
}: {
  cwByYear: Array<{ year: string; count: number }>;
  ddbByYear: Array<{ year: string; count: number }> | null;
  ddbByYearPagoValidado: Array<{ year: string; count: number }> | null | undefined;
  ddbByYearPagoValidadoDec: Array<{ year: string; count: number }> | null | undefined;
  loading: boolean;
}): React.ReactElement {
  const cwMap = new Map(cwByYear.map((r) => [r.year, r.count]));
  const ddbMap = ddbByYear ? new Map(ddbByYear.map((r) => [r.year, r.count])) : null;
  const pvMap = ddbByYearPagoValidado ? new Map(ddbByYearPagoValidado.map((r) => [r.year, r.count])) : null;
  const pvDecMap = ddbByYearPagoValidadoDec ? new Map(ddbByYearPagoValidadoDec.map((r) => [r.year, r.count])) : null;
  const years = new Set([
    ...cwMap.keys(),
    ...(ddbMap ? ddbMap.keys() : []),
    ...(pvDecMap ? pvDecMap.keys() : []),
  ]);
  const sortedYears = Array.from(years).sort();

  return (
    <div className="rounded-xl border border-slate-700/50 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800/70 text-left">
            <th className="px-3 py-2 font-medium text-muted-foreground">Año</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">
              paymentRecords
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">datamappingRecords</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">
              DataMapping (PV − DEC)
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">
              Diferencia
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedYears.map((year) => {
            const cw = cwMap.get(year) ?? 0;
            const ddb = loading ? null : (ddbMap?.get(year) ?? 0);
            const pv = loading ? null : (pvMap?.get(year) ?? ddb ?? 0);
            const pvDec = loading ? null : (pvDecMap?.get(year) ?? 0);
            const pagoValidadoMenosDec =
              pv != null || pvDec != null ? (pv ?? 0) - (pvDec ?? 0) : (ddb ?? 0);
            const diff = cw - pagoValidadoMenosDec;
            const { text: diffText, className: diffClass } = formatDiff(diff);
            const showPv = pvMap != null && (pvMap.get(year) ?? 0) !== (ddb ?? 0);
            const showPvDec = pvDecMap != null && (pvDecMap.get(year) ?? 0) !== (pv ?? 0);
            return (
              <tr key={year} className="border-t border-slate-700/50">
                <td className="px-3 py-2 font-medium">{year}</td>
                <td className="px-3 py-2 text-right tabular-nums text-indigo-300">
                  {cw.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-300">
                  {loading ? "…" : (
                    <>
                      {(ddb ?? 0).toLocaleString()}
                      {showPv && (
                        <span className="block text-xs text-amber-200/80">
                          PAGO VALIDADO: {(pv ?? 0).toLocaleString()}
                        </span>
                      )}
                      {showPvDec && (
                        <span className="block text-xs text-amber-200/70">
                          PAGO VALIDADO - DEC: {(pvDec ?? 0).toLocaleString()}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-200/90">
                  {loading ? "…" : pagoValidadoMenosDec.toLocaleString()}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${diffClass}`}>
                  {loading ? "…" : diffText}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Por mes: datamapping (Total / PAGO VALIDADO / PAGO VALIDADO - DEC). Diferencia = CW − (PAGO VALIDADO − PAGO VALIDADO DEC). */
function PorMesTable({
  cwByMonth,
  ddbByMonth,
  loading,
}: {
  cwByMonth: SourceMonthStats[];
  ddbByMonth: SourceMonthStats[] | null;
  loading: boolean;
}): React.ReactElement {
  const cwMap = new Map(cwByMonth.map((s) => [s.month, s.totalRecords]));
  const ddbMap = ddbByMonth ? new Map(ddbByMonth.map((s) => [s.month, s.totalRecords])) : null;
  const allMonths = generateMonthRange(PERIOD_START, PERIOD_END);
  const monthsWithData = new Set([
    ...cwMap.keys(),
    ...(ddbMap ? ddbMap.keys() : []),
    ...allMonths,
  ]);
  const sortedMonths = Array.from(monthsWithData).sort();

  return (
    <div className="rounded-xl border border-slate-700/50 overflow-hidden max-h-64 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-800/90">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium text-muted-foreground">Mes</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">
              paymentRecords
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">datamappingRecords</th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">
              DataMapping (PV − DEC)
            </th>
            <th className="px-3 py-2 font-medium text-muted-foreground text-right">
              Diferencia
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedMonths.map((month) => {
            const cw = cwMap.get(month) ?? 0;
            const ddb = loading ? null : (ddbMap?.get(month) ?? 0);
            const row = ddbByMonth?.find((m) => m.month === month);
            const pv = loading ? null : (row?.totalRecordsPagoValidado ?? ddb ?? 0);
            const pvDec = loading ? null : (row?.totalRecordsPagoValidadoDec ?? 0);
            const pagoValidadoMenosDec =
              pv != null || pvDec != null ? (pv ?? 0) - (pvDec ?? 0) : (ddb ?? 0);
            const diff = cw - pagoValidadoMenosDec;
            const { text: diffText, className: diffClass } = formatDiff(diff);
            const showPv = row && row.totalRecordsPagoValidado != null && row.totalRecordsPagoValidado !== row.totalRecords;
            const showPvDec = row && row.totalRecordsPagoValidadoDec != null;
            return (
              <tr key={month} className="border-t border-slate-700/50">
                <td className="px-3 py-1.5 font-medium">{month}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-indigo-300">
                  {cw.toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-amber-300">
                  {loading ? "…" : (
                    <>
                      {(ddb ?? 0).toLocaleString()}
                      {showPv && (
                        <span className="block text-xs text-amber-200/80">
                          PAGO VALIDADO: {(row?.totalRecordsPagoValidado ?? 0).toLocaleString()}
                        </span>
                      )}
                      {showPvDec && (
                        <span className="block text-xs text-amber-200/70">
                          PAGO VALIDADO - DEC: {(row?.totalRecordsPagoValidadoDec ?? 0).toLocaleString()}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-amber-200/90">
                  {loading ? "…" : pagoValidadoMenosDec.toLocaleString()}
                </td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${diffClass}`}>
                  {loading ? "…" : diffText}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Calcula la Diferencia oficial del mes (Cloudwatch − (PV − DEC)) para que el Total por día coincida con el resumen. */
function getResumenMesSeleccionadoDiferencia(
  month: string,
  cwByMonth: SourceMonthStats[],
  ddbByMonth: SourceMonthStats[] | null,
  loading: boolean
): number | null {
  if (loading) return null;
  const cwMap = new Map(cwByMonth.map((s) => [s.month, s.totalRecords]));
  const ddbMap = ddbByMonth ? new Map(ddbByMonth.map((s) => [s.month, s.totalRecords])) : null;
  const cw = cwMap.get(month) ?? 0;
  const ddb = ddbMap?.get(month) ?? 0;
  const row = ddbByMonth?.find((m) => m.month === month);
  const pv = row?.totalRecordsPagoValidado ?? ddb ?? 0;
  const pvDec = row?.totalRecordsPagoValidadoDec ?? 0;
  const pagoValidadoMenosDec = (pv ?? 0) - (pvDec ?? 0);
  return cw - pagoValidadoMenosDec;
}

/** Por día del mes seleccionado: tabla con conceptos a la izquierda y una columna por día. Total al final = resumen del mes. Si se pasa ddbByDatePagoValidadoDec (tras recalcular), se muestran DEC y PV−DEC por día y Diferencia = CW − (PV−DEC). */
function PorDiaDetail({
  month,
  cwByDate,
  ddbByDate,
  ddbByDatePagoValidadoDec,
  loading,
  diferenciaOficial,
  cwByMonth,
  ddbByMonth,
}: {
  month: string;
  cwByDate: Array<{ date: string; count: number }>;
  ddbByDate: Array<{ date: string; count: number }> | null;
  /** Por día: cuenta PAGO VALIDADO - DEC. Si existe (tras recalcular datamapping), se muestran DEC y PV−DEC por día. */
  ddbByDatePagoValidadoDec?: Array<{ date: string; count: number }> | null;
  loading: boolean;
  diferenciaOficial?: number | null;
  /** Para columna Total (totales del mes). */
  cwByMonth?: SourceMonthStats[];
  ddbByMonth?: SourceMonthStats[] | null;
}): React.ReactElement | null {
  const cwDates = new Set(cwByDate.map((d) => d.date));
  const ddbDates = new Set(ddbByDate?.map((d) => d.date) ?? []);
  const allDates = Array.from(new Set([...cwDates, ...ddbDates])).sort();
  if (allDates.length === 0 && !loading) return null;

  const cwMap = new Map(cwByDate.map((d) => [d.date, d.count]));
  const ddbMap = new Map(ddbByDate?.map((d) => [d.date, d.count]) ?? []);
  const ddbDecMap = new Map(
    ddbByDatePagoValidadoDec?.map((d) => [d.date, d.count]) ?? []
  );
  const hasDecPerDay = ddbByDatePagoValidadoDec != null && ddbByDatePagoValidadoDec.length > 0;

  const totalCw = cwByMonth ? (cwByMonth.find((m) => m.month === month)?.totalRecords ?? 0) : 0;
  const ddbRow = ddbByMonth?.find((m) => m.month === month);
  const totalDdb = ddbRow?.totalRecords ?? 0;
  const totalDec = ddbRow?.totalRecordsPagoValidadoDec ?? 0;
  const totalPvMinusDec =
    ddbRow && (ddbRow.totalRecordsPagoValidado != null || ddbRow.totalRecordsPagoValidadoDec != null)
      ? (ddbRow.totalRecordsPagoValidado ?? totalDdb) - (ddbRow.totalRecordsPagoValidadoDec ?? 0)
      : totalDdb;
  const totalDiff = diferenciaOficial ?? (totalCw - totalPvMinusDec);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-5 space-y-3"
    >
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Por día ({month}) — conceptos a la izquierda, una columna por día
      </p>
      <div className="rounded-xl border border-slate-700/50 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800/70 text-left">
              <th className="px-3 py-2 font-medium text-muted-foreground sticky left-0 bg-slate-800/95 min-w-40">
                Concepto
              </th>
              {allDates.map((date) => (
                <th
                  key={date}
                  className="px-2 py-1.5 font-medium text-muted-foreground text-right whitespace-nowrap"
                >
                  {date.slice(8)}
                </th>
              ))}
              <th className="px-3 py-2 font-medium text-muted-foreground text-right bg-slate-800/90">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-700/50">
              <td className="px-3 py-1.5 font-medium text-muted-foreground sticky left-0 bg-slate-800/50">
                DataMappings Total
              </td>
              {allDates.map((date) => (
                <td key={date} className="px-2 py-1.5 text-right tabular-nums text-amber-300/90">
                  {loading ? "…" : (ddbMap.get(date) ?? 0).toLocaleString()}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-amber-300 font-medium bg-slate-800/30">
                {loading ? "…" : totalDdb.toLocaleString()}
              </td>
            </tr>
            <tr className="border-t border-slate-700/50">
              <td className="px-3 py-1.5 font-medium text-muted-foreground sticky left-0 bg-slate-800/50">
                DEC
              </td>
              {allDates.map((date) => (
                <td key={date} className="px-2 py-1.5 text-right tabular-nums text-amber-200/80">
                  {loading ? "…" : hasDecPerDay ? (ddbDecMap.get(date) ?? 0).toLocaleString() : "—"}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums text-amber-200/80 bg-slate-800/30">
                {loading ? "…" : totalDec.toLocaleString()}
              </td>
            </tr>
            <tr className="border-t border-slate-700/50">
              <td className="px-3 py-1.5 font-bold text-muted-foreground sticky left-0 bg-slate-800/50">
                PV − DEC
              </td>
              {allDates.map((date) => {
                const pv = ddbMap.get(date) ?? 0;
                const dec = ddbDecMap.get(date) ?? 0;
                const pvMinusDec = pv - dec;
                return (
                  <td key={date} className="px-2 py-1.5 text-right tabular-nums font-bold text-amber-200/90">
                    {loading ? "…" : hasDecPerDay ? pvMinusDec.toLocaleString() : "—"}
                  </td>
                );
              })}
              <td className="px-3 py-1.5 text-right tabular-nums font-bold text-amber-200/90 bg-slate-800/30">
                {loading ? "…" : totalPvMinusDec.toLocaleString()}
              </td>
            </tr>
            <tr className="border-t border-slate-700/50">
              <td className="px-3 py-1.5 font-bold text-muted-foreground sticky left-0 bg-slate-800/50">
                Cloudwatch
              </td>
              {allDates.map((date) => (
                <td key={date} className="px-2 py-1.5 text-right tabular-nums font-bold text-indigo-300">
                  {loading ? "…" : (cwMap.get(date) ?? 0).toLocaleString()}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums font-bold text-indigo-300 bg-slate-800/30">
                {loading ? "…" : totalCw.toLocaleString()}
              </td>
            </tr>
            <tr className="border-t border-slate-700/50">
              <td className="px-3 py-1.5 font-bold text-muted-foreground sticky left-0 bg-slate-800/50">
                Diferencia
              </td>
              {allDates.map((date) => {
                const cw = cwMap.get(date) ?? 0;
                const ddb = ddbMap.get(date) ?? 0;
                const dec = ddbDecMap.get(date) ?? 0;
                const pvMinusDec = hasDecPerDay ? ddb - dec : ddb;
                const d = cw - pvMinusDec;
                const { text, className } = formatDiff(d);
                return (
                  <td key={date} className={`px-2 py-1.5 text-right tabular-nums font-bold ${className}`}>
                    {loading ? "…" : text}
                  </td>
                );
              })}
              <td
                className={`px-3 py-1.5 text-right tabular-nums font-bold bg-slate-800/30 ${formatDiff(totalDiff).className}`}
              >
                {loading ? "…" : formatDiff(totalDiff).text}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {!hasDecPerDay && (
        <p className="text-[9px] text-muted-foreground">
          DEC y PV−DEC por día se calculan al usar &quot;Recalcular datamappingRecords&quot;; hasta entonces por día solo total DDB, Cloudwatch y Diferencia (CW − DDB).
        </p>
      )}
    </motion.div>
  );
}

function deriveByYear(months: SourceMonthStats[]): Array<{ year: string; count: number }> {
  const byYear = new Map<string, number>();
  for (const s of months) {
    const y = s.month.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + s.totalRecords);
  }
  return Array.from(byYear.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

export function RegistrosCargadosSection({
  cloudwatchMonths,
  datamappingMonths,
  datamappingSavedStats,
  selectedMonth,
  onMonthSelect,
  cloudwatchMonthDetail,
  cloudwatchAudit,
  datamappingMonthDetail,
  datamappingStatsLoading,
  onRefreshDatamapping,
  onRefreshPaymentRecords,
  paymentRecordsRecalcLoading = false,
}: RegistrosCargadosSectionProps): React.ReactElement {
  const cwTotal = cloudwatchMonths?.reduce((s, m) => s + m.totalRecords, 0) ?? 0;
  const ddbTotal =
    datamappingSavedStats?.total ??
    datamappingMonths?.reduce((s, m) => s + m.totalRecords, 0) ??
    0;
  const ddbPagoValidado = datamappingSavedStats?.totalPagoValidado;
  const ddbPagoValidadoDec = datamappingSavedStats?.totalPagoValidadoDec;
  const cwByYear = deriveByYear(cloudwatchMonths ?? []);
  const ddbByYear = datamappingSavedStats?.byYear ?? deriveByYear(datamappingMonths ?? []);
  const ddbByYearPagoValidado = datamappingSavedStats?.byYearPagoValidado;
  const ddbByYearPagoValidadoDec = datamappingSavedStats?.byYearPagoValidadoDec;
  const anyRecalcLoading = datamappingStatsLoading || paymentRecordsRecalcLoading;

  return (
    <div className="glass-card rounded-xl p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Registros cargados</h2>
        <div className="flex flex-wrap gap-2">
          {onRefreshPaymentRecords && (
            <button
              type="button"
              onClick={onRefreshPaymentRecords}
              disabled={anyRecalcLoading}
              className="text-xs px-2 py-1 rounded border border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50"
            >
              {paymentRecordsRecalcLoading ? "Calculando…" : "Recalcular paymentRecords"}
            </button>
          )}
          {onRefreshDatamapping && (
            <button
              type="button"
              onClick={onRefreshDatamapping}
              disabled={anyRecalcLoading}
              className="text-xs px-2 py-1 rounded border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {datamappingStatsLoading ? "Calculando…" : "Recalcular datamappingRecords"}
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Diferencias entre tablas Convex: <strong>paymentRecords</strong> (origen CloudWatch) y{" "}
        <strong>datamappingRecords</strong> (origen DynamoDB). Todo se lee de Convex, sin llamar a AWS.
      </p>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
        <p className="font-medium mb-1">Criterio de comparación (mes del pago)</p>
        <p className="text-muted-foreground">
          <strong>paymentRecords</strong> y <strong>datamappingRecords</strong> se agrupan por <strong>mes del pago</strong> (fechaTransaccion / importMonth en hora México). La diferencia refleja pagos que están en una fuente y no en la otra para ese mes. No es el mismo criterio: un pago que ocurrió en enero puede haberse registrado en DynamoDB en febrero, así que cuenta en enero en paymentRecords y en febrero en datamappingRecords. No es un error de extracción, enriquecimiento ni duplicados; es la diferencia entre “mes del pago” y “mes de actualización”.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Ambas tablas actualizan sus estadísticas en Convex al cargar o borrar: paymentRecords en cada día sincronizado,
        datamappingRecords en cada lote insertado o borrado. La UI se actualiza al instante. Los botones sirven para{" "}
        <strong className="text-amber-400/90">recalcular manualmente</strong> si hace falta (p. ej. datos previos sin stats).
      </p>

      <TotalesRow
        cwTotal={cwTotal}
        ddbTotal={datamappingStatsLoading ? null : ddbTotal}
        ddbPagoValidado={datamappingStatsLoading ? undefined : ddbPagoValidado}
        ddbPagoValidadoDec={datamappingStatsLoading ? undefined : ddbPagoValidadoDec}
        loading={datamappingStatsLoading}
      />

      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Por año
        </p>
        <PorAnioTable
          cwByYear={cwByYear}
          ddbByYear={datamappingStatsLoading ? null : ddbByYear}
          ddbByYearPagoValidado={datamappingStatsLoading ? undefined : ddbByYearPagoValidado}
          ddbByYearPagoValidadoDec={datamappingStatsLoading ? undefined : ddbByYearPagoValidadoDec}
          loading={datamappingStatsLoading}
        />
      </div>

      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Por mes
        </p>
        <PorMesTable
          cwByMonth={cloudwatchMonths ?? []}
          ddbByMonth={datamappingMonths ?? null}
          loading={datamappingStatsLoading}
        />
      </div>

      {/* Detalle por mes: selector CloudWatch + por día ambas fuentes */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Detalle por mes (selecciona un mes)
        </p>
        {cloudwatchMonths ? (
          <IngestionStatus
            allMonthsStatus={cloudwatchMonths}
            selectedMonth={selectedMonth}
            selectedMonthDetail={undefined}
            onMonthSelect={onMonthSelect}
          />
        ) : (
          <div className="rounded-xl p-5 text-muted-foreground text-sm border border-slate-700/50">
            Cargando...
          </div>
        )}

        {selectedMonth && (
          <div className="mt-4 space-y-4">
            <PorDiaDetail
              month={selectedMonth}
              cwByDate={cloudwatchMonthDetail?.byDate ?? []}
              ddbByDate={datamappingMonthDetail?.byDate ?? null}
              ddbByDatePagoValidadoDec={datamappingMonthDetail?.byDatePagoValidadoDec ?? null}
              loading={datamappingStatsLoading}
              diferenciaOficial={getResumenMesSeleccionadoDiferencia(
                selectedMonth,
                cloudwatchMonths ?? [],
                datamappingMonths ?? null,
                datamappingStatsLoading
              )}
              cwByMonth={cloudwatchMonths ?? undefined}
              ddbByMonth={datamappingMonths ?? null}
            />
            {cloudwatchAudit && cloudwatchAudit.some((a) => a.truncationRisk) && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-200/90">
                <p className="font-medium mb-1">Riesgo de truncamiento (CloudWatch)</p>
                <p className="text-muted-foreground mb-2">
                  Días con posible pérdida por límite 10k por ventana. Revisar si el conteo del mes es menor al esperado.
                </p>
                <p className="tabular-nums">
                  {cloudwatchAudit
                    .filter((a) => a.truncationRisk)
                    .map((a) => a.date)
                    .sort()
                    .join(", ")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
