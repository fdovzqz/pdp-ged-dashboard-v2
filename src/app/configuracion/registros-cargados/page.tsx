"use client";

import { useState, useCallback } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { RegistrosCargadosSection } from "@/components/dashboard/RegistrosCargadosSection";

export default function RegistrosCargadosPage(): React.ReactElement {
  const [selectedMonthRegistros, setSelectedMonthRegistros] = useState<string | null>(null);
  const [datamappingStatsLoading, setDatamappingStatsLoading] = useState(false);
  const [paymentRecordsRecalcLoading, setPaymentRecordsRecalcLoading] = useState(false);

  const allMonthsStatus = useQuery(api.cloudwatchQueries.getAllMonthsStatus, {});
  const allDatamappingMonthsStatus = useQuery(
    api.datamappingQueries.getAllDatamappingMonthsStatus,
    {}
  );
  const allDatamappingMonthsStatusByFechaTransaccion = useQuery(
    api.datamappingQueries.getAllDatamappingMonthsStatusByFechaTransaccion,
    {}
  );
  const datamappingSavedStats = useQuery(api.datamappingQueries.getDatamappingIngestionStatsSaved, {});
  const selectedMonthStats = useQuery(
    api.cloudwatchQueries.getMonthStats,
    selectedMonthRegistros ? { month: selectedMonthRegistros } : "skip"
  );
  const [auditStart, auditEnd] =
    selectedMonthRegistros
      ? (() => {
          const [y, m] = selectedMonthRegistros.split("-").map(Number);
          const lastDay = new Date(y, m, 0).getDate();
          return [
            `${selectedMonthRegistros}-01`,
            `${selectedMonthRegistros}-${String(lastDay).padStart(2, "0")}`,
          ];
        })()
      : [null, null];
  const cloudwatchAuditForMonth = useQuery(
    api.cloudwatchQueries.listCloudwatchIngestionAudit,
    auditStart && auditEnd ? { startDate: auditStart, endDate: auditEnd } : "skip"
  );
  const datamappingMonthStats = useQuery(
    api.datamappingQueries.getDatamappingMonthStats,
    selectedMonthRegistros ? { month: selectedMonthRegistros } : "skip"
  );
  const datamappingMonthStatsByFechaTransaccion = useQuery(
    api.datamappingQueries.getDatamappingMonthStatsByFechaTransaccion,
    selectedMonthRegistros ? { month: selectedMonthRegistros } : "skip"
  );

  const getDatamappingIngestionStats = useAction(api.actions.getDatamappingIngestionStats);
  const recreateDatamappingMonthStatsByFechaTransaccion = useAction(
    api.actions.recreateDatamappingMonthStatsByFechaTransaccion
  );
  const recreateAllMonthStatsFromPaymentRecords = useAction(
    api.actions.recreateAllMonthStatsFromPaymentRecords
  );

  const refreshDatamappingStats = useCallback(async (): Promise<void> => {
    setDatamappingStatsLoading(true);
    try {
      await getDatamappingIngestionStats({});
      await recreateDatamappingMonthStatsByFechaTransaccion({});
    } catch (err) {
      console.error(err);
    } finally {
      setDatamappingStatsLoading(false);
    }
  }, [getDatamappingIngestionStats, recreateDatamappingMonthStatsByFechaTransaccion]);

  const refreshPaymentRecordsStats = useCallback(async (): Promise<void> => {
    setPaymentRecordsRecalcLoading(true);
    try {
      await recreateAllMonthStatsFromPaymentRecords({});
    } catch (err) {
      console.error(err);
    } finally {
      setPaymentRecordsRecalcLoading(false);
    }
  }, [recreateAllMonthStatsFromPaymentRecords]);

  const datamappingMonths =
    allDatamappingMonthsStatusByFechaTransaccion?.length
      ? allDatamappingMonthsStatusByFechaTransaccion
      : allDatamappingMonthsStatus;

  const datamappingSavedStatsForSection =
    allDatamappingMonthsStatusByFechaTransaccion?.length
      ? (() => {
          const months = allDatamappingMonthsStatusByFechaTransaccion;
          const byYear = new Map<string, number>();
          const byYearPagoValidado = new Map<string, number>();
          const byYearPagoValidadoDec = new Map<string, number>();
          for (const m of months) {
            const year = m.month.slice(0, 4);
            byYear.set(year, (byYear.get(year) ?? 0) + m.totalRecords);
            byYearPagoValidado.set(
              year,
              (byYearPagoValidado.get(year) ?? 0) + (m.totalRecordsPagoValidado ?? m.totalRecords)
            );
            byYearPagoValidadoDec.set(
              year,
              (byYearPagoValidadoDec.get(year) ?? 0) + (m.totalRecordsPagoValidadoDec ?? 0)
            );
          }
          return {
            total: months.reduce((s, m) => s + m.totalRecords, 0),
            totalPagoValidado: months.reduce(
              (s, m) => s + (m.totalRecordsPagoValidado ?? m.totalRecords),
              0
            ),
            totalPagoValidadoDec: months.reduce(
              (s, m) => s + (m.totalRecordsPagoValidadoDec ?? 0),
              0
            ),
            byYear: Array.from(byYear.entries())
              .map(([year, count]) => ({ year, count }))
              .sort((a, b) => a.year.localeCompare(b.year)),
            byYearPagoValidado: Array.from(byYearPagoValidado.entries())
              .map(([year, count]) => ({ year, count }))
              .sort((a, b) => a.year.localeCompare(b.year)),
            byYearPagoValidadoDec: Array.from(byYearPagoValidadoDec.entries())
              .map(([year, count]) => ({ year, count }))
              .sort((a, b) => a.year.localeCompare(b.year)),
            byMonth: months.map((m) => ({
              month: m.month,
              count: m.totalRecordsPagoValidado ?? m.totalRecords,
            })),
          };
        })()
      : datamappingSavedStats ?? undefined;

  const datamappingMonthDetail =
    selectedMonthRegistros &&
    (datamappingMonthStatsByFechaTransaccion ?? datamappingMonthStats)
      ? (() => {
          const stats = datamappingMonthStatsByFechaTransaccion ?? datamappingMonthStats!;
          return {
            totalRecords: stats.totalRecords,
            daysWithData: stats.daysWithData,
            byDate: stats.byDate,
            byDatePagoValidadoDec:
              datamappingMonthStatsByFechaTransaccion?.byDatePagoValidadoDec,
          };
        })()
      : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-100">Registros cargados</h1>
      <RegistrosCargadosSection
        cloudwatchMonths={allMonthsStatus ?? undefined}
        datamappingMonths={datamappingMonths ?? undefined}
        datamappingSavedStats={datamappingSavedStatsForSection}
        selectedMonth={selectedMonthRegistros}
        onMonthSelect={setSelectedMonthRegistros}
        cloudwatchMonthDetail={
          selectedMonthRegistros && selectedMonthStats?.ingestionStatus
            ? {
                totalRecords: selectedMonthStats.ingestionStatus.totalRecords,
                daysWithData: selectedMonthStats.ingestionStatus.daysWithData,
                byDate: selectedMonthStats.ingestionStatus.byDate,
              }
            : undefined
        }
        cloudwatchAudit={
          selectedMonthRegistros && cloudwatchAuditForMonth
            ? cloudwatchAuditForMonth.map((a) => ({
                date: a.date,
                truncationRisk: a.truncationRisk,
              }))
            : undefined
        }
        datamappingMonthDetail={datamappingMonthDetail}
        datamappingStatsLoading={datamappingStatsLoading}
        onRefreshDatamapping={refreshDatamappingStats}
        onRefreshPaymentRecords={refreshPaymentRecordsStats}
        paymentRecordsRecalcLoading={paymentRecordsRecalcLoading}
      />
    </div>
  );
}
