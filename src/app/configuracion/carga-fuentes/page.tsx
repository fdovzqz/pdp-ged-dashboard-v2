"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery, useConvex } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Database, RefreshCw, Trash2, StopCircle } from "lucide-react";
import { formatErrorMessage } from "@/lib/formatErrorMessage";
import {
  PERIOD_START,
  PERIOD_END,
  PERIOD_START_DATE,
  PERIOD_END_DATE,
  DATAMAPPING_HISTORY_START,
  generateMonthRange,
} from "@/lib/constants";

const DELETE_CONFIRM_WORD = "BORRAR";
const CLOUDWATCH_FULL_START = "2024-01";

export default function CargaFuentesPage(): React.ReactElement {
  const [selectedMonthRegistros, setSelectedMonthRegistros] = useState<string | null>(null);
  const [registrosDeleteMonthDialogOpen, setRegistrosDeleteMonthDialogOpen] = useState(false);
  const [registrosDeleteAllDialogOpen, setRegistrosDeleteAllDialogOpen] = useState(false);
  const [cloudwatchClearError, setCloudwatchClearError] = useState<string | null>(null);
  const [deleteMonthStep, setDeleteMonthStep] = useState<1 | 2>(1);
  const [deleteMonthConfirmText, setDeleteMonthConfirmText] = useState("");
  const [deleteAllStep, setDeleteAllStep] = useState<1 | 2>(1);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [dynamoDeleteStep, setDynamoDeleteStep] = useState<1 | 2>(1);
  const [dynamoDeleteConfirmText, setDynamoDeleteConfirmText] = useState("");

  const [startDate, setStartDate] = useState(PERIOD_START_DATE);
  const [endDate, setEndDate] = useState(PERIOD_END_DATE);
  const [cloudwatchFromDate, setCloudwatchFromDate] = useState(PERIOD_START_DATE);
  const [cloudwatchFullTriggering, setCloudwatchFullTriggering] = useState(false);
  const [cloudwatchFromDateTriggering, setCloudwatchFromDateTriggering] = useState(false);
  const [cloudwatchIncrementalTriggering, setCloudwatchIncrementalTriggering] = useState(false);
  const [cloudwatchIncrementalError, setCloudwatchIncrementalError] = useState<string | null>(null);

  const [dynamoSinceDate, setDynamoSinceDate] = useState("2026-01-01");
  const [dynamoError, setDynamoError] = useState<string | null>(null);
  const [dynamoDeleteDialogOpen, setDynamoDeleteDialogOpen] = useState(false);
  const [dynamoClearTriggering, setDynamoClearTriggering] = useState(false);
  const [dynamoHistoryError, setDynamoHistoryError] = useState<string | null>(null);
  const [datamappingRangeStart, setDatamappingRangeStart] = useState(
    DATAMAPPING_HISTORY_START
  );
  const [datamappingRangeEnd, setDatamappingRangeEnd] = useState(PERIOD_END_DATE);
  const [dynamoReextractError, setDynamoReextractError] = useState<string | null>(null);
  const [dynamoSyncByMonthsTriggering, setDynamoSyncByMonthsTriggering] = useState(false);
  const [dynamoIncrementalError, setDynamoIncrementalError] = useState<string | null>(null);
  const [dynamoIncrementalTriggering, setDynamoIncrementalTriggering] = useState(false);
  const [cloudwatchSyncByMonthsTriggering, setCloudwatchSyncByMonthsTriggering] = useState(false);
  const [cloudwatchSyncByMonthsError, setCloudwatchSyncByMonthsError] = useState<string | null>(null);
  const [cloudwatchDeterministicMode, setCloudwatchDeterministicMode] = useState(false);
  const [consolidateFromDate, setConsolidateFromDate] = useState(PERIOD_START_DATE);
  const [consolidateToDate, setConsolidateToDate] = useState(PERIOD_END_DATE);
  const [consolidateTriggering, setConsolidateTriggering] = useState(false);
  const [consolidateError, setConsolidateError] = useState<string | null>(null);
  const [consolidateSuccess, setConsolidateSuccess] = useState<string | null>(null);
  const [loadFromDateInngestTriggering, setLoadFromDateInngestTriggering] = useState(false);
  const [loadFromDateInngestJobId, setLoadFromDateInngestJobId] = useState<
    Id<"pipelineJobs"> | null
  >(null);
  const [fechaTransaccionSinceDate, setFechaTransaccionSinceDate] = useState("2024-01-01");
  const [fechaTransaccionRangeStart, setFechaTransaccionRangeStart] = useState("2024-07-01");
  const [fechaTransaccionRangeEnd, setFechaTransaccionRangeEnd] = useState("2024-07-03");
  const [fechaTransaccionRangeTriggering, setFechaTransaccionRangeTriggering] = useState(false);
  const [fechaTransaccionFullInngestTriggering, setFechaTransaccionFullInngestTriggering] =
    useState(false);
  const [fechaTransaccionFromDateInngestTriggering, setFechaTransaccionFromDateInngestTriggering] =
    useState(false);
  const [fechaTransaccionFromDateInngestJobId, setFechaTransaccionFromDateInngestJobId] =
    useState<Id<"pipelineJobs"> | null>(null);
  const [dynamoHistoryTriggering, setDynamoHistoryTriggering] = useState(false);
  const [enrichmentByMonthsStart, setEnrichmentByMonthsStart] = useState(PERIOD_START);
  const [enrichmentByMonthsEnd, setEnrichmentByMonthsEnd] = useState(PERIOD_END);
  const [enrichmentByMonthsTriggering, setEnrichmentByMonthsTriggering] = useState(false);
  const [enrichmentByMonthsError, setEnrichmentByMonthsError] = useState<string | null>(null);
  const [enrichmentPendingCountLoading, setEnrichmentPendingCountLoading] = useState(false);
  const [enrichmentPendingCountResult, setEnrichmentPendingCountResult] = useState<{
    counts: Record<string, number>;
    truncated?: string[];
  } | null>(null);
  const [enrichmentPendingCountError, setEnrichmentPendingCountError] = useState<string | null>(null);

  const [effectiveStart, effectiveEnd] =
    startDate && endDate && startDate <= endDate
      ? [startDate, endDate]
      : startDate && endDate
        ? [endDate, startDate]
        : [PERIOD_START_DATE, PERIOD_END_DATE];
  const convex = useConvex();
  const [datamappingWatermark, setDatamappingWatermark] = useState<{
    lastUpdatedAt: string | null;
  } | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    convex.query(api.datamappingQueries.getDatamappingWatermark).then((value) => {
      if (!cancelled) setDatamappingWatermark(value);
    });
    return () => {
      cancelled = true;
    };
  }, [convex]);
  const latestDatamappingFullHistoryJob = useQuery(
    api.pipelineQueries.getLatestDatamappingFullHistoryJob
  );
  const latestDatamappingClearJob = useQuery(
    api.pipelineQueries.getLatestDatamappingClearJob
  );
  const latestFechaTransaccionFullJob = useQuery(
    api.pipelineQueries.getLatestFechaTransaccionFullJob
  );
  const latestCloudWatchSyncByMonthsJob = useQuery(
    api.pipelineQueries.getLatestCloudwatchSyncByMonthsJob
  );
  const latestCloudwatchSyncByRangeJob = useQuery(
    api.pipelineQueries.getLatestCloudwatchSyncByRangeJob
  );
  const latestCloudwatchDeterministicSyncByMonthsJob = useQuery(
    api.pipelineQueries.getLatestCloudwatchDeterministicSyncByMonthsJob
  );
  const latestCloudwatchDeterministicSyncByRangeJob = useQuery(
    api.pipelineQueries.getLatestCloudwatchDeterministicSyncByRangeJob
  );
  const latestCloudwatchIncrementalJob = useQuery(
    api.pipelineQueries.getLatestCloudwatchIncrementalJob
  );
  const cloudwatchWatermark = useQuery(api.cloudwatchQueries.getCloudwatchWatermark);
  const latestCloudwatchClearJob = useQuery(
    api.pipelineQueries.getLatestCloudwatchClearJob
  );
  const latestDatamappingSyncByMonthsJob = useQuery(
    api.pipelineQueries.getLatestDatamappingSyncByMonthsJob
  );
  const latestDatamappingSyncByRangeJob = useQuery(
    api.pipelineQueries.getLatestDatamappingSyncByRangeJob
  );
  const latestDatamappingLoadFromDateJob = useQuery(
    api.pipelineQueries.getLatestDatamappingLoadFromDateJob
  );
  const latestDatamappingIncrementalJob = useQuery(
    api.pipelineQueries.getLatestDatamappingIncrementalJob
  );
  const latestDatamappingEnrichmentByMonthsJob = useQuery(
    api.pipelineQueries.getLatestDatamappingEnrichmentByMonthsJob
  );
  const enrichmentJobUnits = useQuery(
    api.pipelineQueries.getPipelineJobUnitsByJobId,
    latestDatamappingEnrichmentByMonthsJob?.status === "running" &&
      latestDatamappingEnrichmentByMonthsJob?._id != null
      ? { jobId: latestDatamappingEnrichmentByMonthsJob._id }
      : "skip"
  );
  const fechaTransaccionJobUnits = useQuery(
    api.pipelineQueries.getPipelineJobUnitsByJobId,
    latestFechaTransaccionFullJob?.status === "running" &&
      latestFechaTransaccionFullJob?._id != null
      ? { jobId: latestFechaTransaccionFullJob._id }
      : "skip"
  );

  const allMonthsStatus = useQuery(api.cloudwatchQueries.getAllMonthsStatus, {});
  const getPendingEnrichmentCountByMonths = useAction(
    api.actions.getPendingEnrichmentCountByMonths
  );
  const cancelPipelineJob = useMutation(api.pipelineMutations.cancelPipelineJob);

  const handleCancelCloudwatchJob = useCallback((): void => {
    if (
      latestCloudWatchSyncByMonthsJob?.status === "running" ||
      latestCloudWatchSyncByMonthsJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestCloudWatchSyncByMonthsJob._id });
    }
    if (
      latestCloudwatchSyncByRangeJob?.status === "running" ||
      latestCloudwatchSyncByRangeJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestCloudwatchSyncByRangeJob._id });
    }
    if (
      latestCloudwatchDeterministicSyncByMonthsJob?.status === "running" ||
      latestCloudwatchDeterministicSyncByMonthsJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestCloudwatchDeterministicSyncByMonthsJob._id });
    }
    if (
      latestCloudwatchDeterministicSyncByRangeJob?.status === "running" ||
      latestCloudwatchDeterministicSyncByRangeJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestCloudwatchDeterministicSyncByRangeJob._id });
    }
    if (
      latestCloudwatchIncrementalJob?.status === "running" ||
      latestCloudwatchIncrementalJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestCloudwatchIncrementalJob._id });
    }
    if (
      latestCloudwatchClearJob?.status === "running" ||
      latestCloudwatchClearJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestCloudwatchClearJob._id });
    }
  }, [
    cancelPipelineJob,
    latestCloudWatchSyncByMonthsJob?.status,
    latestCloudWatchSyncByMonthsJob?._id,
    latestCloudwatchSyncByRangeJob?.status,
    latestCloudwatchSyncByRangeJob?._id,
    latestCloudwatchDeterministicSyncByMonthsJob?.status,
    latestCloudwatchDeterministicSyncByMonthsJob?._id,
    latestCloudwatchDeterministicSyncByRangeJob?.status,
    latestCloudwatchDeterministicSyncByRangeJob?._id,
    latestCloudwatchIncrementalJob?.status,
    latestCloudwatchIncrementalJob?._id,
    latestCloudwatchClearJob?.status,
    latestCloudwatchClearJob?._id,
  ]);

  const handleCancelDatamappingJob = useCallback((): void => {
    if (
      latestDatamappingFullHistoryJob?.status === "running" ||
      latestDatamappingFullHistoryJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestDatamappingFullHistoryJob._id });
    }
    if (
      latestDatamappingSyncByMonthsJob?.status === "running" ||
      latestDatamappingSyncByMonthsJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestDatamappingSyncByMonthsJob._id });
    }
    if (
      latestDatamappingSyncByRangeJob?.status === "running" ||
      latestDatamappingSyncByRangeJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestDatamappingSyncByRangeJob._id });
    }
    if (
      latestDatamappingLoadFromDateJob?.status === "running" ||
      latestDatamappingLoadFromDateJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestDatamappingLoadFromDateJob._id });
    }
    if (
      latestDatamappingIncrementalJob?.status === "running" ||
      latestDatamappingIncrementalJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestDatamappingIncrementalJob._id });
    }
    if (
      latestDatamappingClearJob?.status === "running" ||
      latestDatamappingClearJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestDatamappingClearJob._id });
    }
    if (
      latestFechaTransaccionFullJob?.status === "running" ||
      latestFechaTransaccionFullJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestFechaTransaccionFullJob._id });
    }
    if (
      latestDatamappingEnrichmentByMonthsJob?.status === "running" ||
      latestDatamappingEnrichmentByMonthsJob?.status === "pending"
    ) {
      cancelPipelineJob({ jobId: latestDatamappingEnrichmentByMonthsJob._id });
    }
  }, [
    cancelPipelineJob,
    latestDatamappingFullHistoryJob?.status,
    latestDatamappingFullHistoryJob?._id,
    latestDatamappingSyncByMonthsJob?.status,
    latestDatamappingSyncByMonthsJob?._id,
    latestDatamappingSyncByRangeJob?.status,
    latestDatamappingSyncByRangeJob?._id,
    latestDatamappingLoadFromDateJob?.status,
    latestDatamappingLoadFromDateJob?._id,
    latestDatamappingIncrementalJob?.status,
    latestDatamappingIncrementalJob?._id,
    latestDatamappingClearJob?.status,
    latestDatamappingClearJob?._id,
    latestFechaTransaccionFullJob?.status,
    latestFechaTransaccionFullJob?._id,
    latestDatamappingEnrichmentByMonthsJob?.status,
    latestDatamappingEnrichmentByMonthsJob?._id,
  ]);

  const handleCloudwatchClearAll = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/cloudwatch/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setCloudwatchClearError(data.error ?? "Error al iniciar job de borrado");
      } else {
        setRegistrosDeleteAllDialogOpen(false);
        setDeleteAllStep(1);
        setDeleteAllConfirmText("");
      }
    } catch (err) {
      setCloudwatchClearError(
        err instanceof Error ? err.message : "Error al iniciar job"
      );
    }
  }, []);

  const handleCloudwatchClearMonth = useCallback(async (month: string): Promise<void> => {
    try {
      const res = await fetch("/api/cloudwatch/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setCloudwatchClearError(data.error ?? "Error al iniciar job de borrado");
      } else {
        setRegistrosDeleteMonthDialogOpen(false);
        setSelectedMonthRegistros(null);
        setDeleteMonthStep(1);
        setDeleteMonthConfirmText("");
      }
    } catch (err) {
      setCloudwatchClearError(
        err instanceof Error ? err.message : "Error al iniciar job"
      );
    }
  }, []);

  const recreateAllMonthStats = useAction(api.actions.recreateAllMonthStatsFromPaymentRecords);
  const [paymentRecordsRecalcLoading, setPaymentRecordsRecalcLoading] = useState(false);
  const refreshPaymentRecordsStats = useCallback(async (): Promise<void> => {
    setPaymentRecordsRecalcLoading(true);
    try {
      await recreateAllMonthStats({});
    } catch (err) {
      console.error(err);
    } finally {
      setPaymentRecordsRecalcLoading(false);
    }
  }, [recreateAllMonthStats]);

  const handleCloudWatchFull = useCallback(async (): Promise<void> => {
    setCloudwatchSyncByMonthsError(null);
    setCloudwatchFullTriggering(true);
    try {
      const res = await fetch("/api/cloudwatch/sync-by-months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: CLOUDWATCH_FULL_START,
          end: PERIOD_END,
          deterministic: cloudwatchDeterministicMode,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setCloudwatchSyncByMonthsError(data.error ?? "Error al iniciar job");
      }
    } catch (err) {
      setCloudwatchSyncByMonthsError(
        err instanceof Error ? err.message : "Error al iniciar job"
      );
    } finally {
      setCloudwatchFullTriggering(false);
    }
  }, [cloudwatchDeterministicMode]);

  const handleCloudWatchSyncByMonths = useCallback(async (): Promise<void> => {
    setCloudwatchSyncByMonthsError(null);
    setCloudwatchSyncByMonthsTriggering(true);
    try {
      const res = await fetch("/api/cloudwatch/sync-by-months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: effectiveStart,
          endDate: effectiveEnd,
          deterministic: cloudwatchDeterministicMode,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setCloudwatchSyncByMonthsError(data.error ?? "Error al iniciar extracción por meses");
      }
    } catch (err) {
      setCloudwatchSyncByMonthsError(
        err instanceof Error ? err.message : "Error al iniciar extracción por meses"
      );
    } finally {
      setCloudwatchSyncByMonthsTriggering(false);
    }
  }, [effectiveStart, effectiveEnd, cloudwatchDeterministicMode]);

  const handleCloudWatchFromDate = useCallback(async (): Promise<void> => {
    setCloudwatchSyncByMonthsError(null);
    setCloudwatchFromDateTriggering(true);
    try {
      const startMonth = cloudwatchFromDate.slice(0, 7);
      const res = await fetch("/api/cloudwatch/sync-by-months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: startMonth,
          end: PERIOD_END,
          deterministic: cloudwatchDeterministicMode,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setCloudwatchSyncByMonthsError(data.error ?? "Error al iniciar job");
      }
    } catch (err) {
      setCloudwatchSyncByMonthsError(
        err instanceof Error ? err.message : "Error al iniciar job"
      );
    } finally {
      setCloudwatchFromDateTriggering(false);
    }
  }, [cloudwatchFromDate, cloudwatchDeterministicMode]);

  const handleCloudwatchConsolidate = useCallback(async (): Promise<void> => {
    setConsolidateError(null);
    setConsolidateSuccess(null);
    setConsolidateTriggering(true);
    try {
      const from = consolidateFromDate.slice(0, 10);
      const to = consolidateToDate.slice(0, 10);
      if (!from || !to || from > to) {
        setConsolidateError("fromDate y toDate (YYYY-MM-DD) requeridos y fromDate <= toDate");
        return;
      }
      const res = await fetch("/api/cloudwatch/consolidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: from, toDate: to }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        setConsolidateError(data.error ?? "Error al programar consolidación");
      } else {
        setConsolidateSuccess(data.message ?? "Consolidación programada (tablas fuente → paymentRecords)");
      }
    } catch (err) {
      setConsolidateError(
        err instanceof Error ? err.message : "Error al programar consolidación"
      );
    } finally {
      setConsolidateTriggering(false);
    }
  }, [consolidateFromDate, consolidateToDate]);

  const handleCloudwatchIncremental = useCallback(async (): Promise<void> => {
    setCloudwatchIncrementalError(null);
    setCloudwatchIncrementalTriggering(true);
    try {
      const res = await fetch("/api/cloudwatch/incremental", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setCloudwatchIncrementalError(data.error ?? "Error al iniciar job");
      }
    } catch (err) {
      setCloudwatchIncrementalError(
        err instanceof Error ? err.message : "Error al iniciar job"
      );
    } finally {
      setCloudwatchIncrementalTriggering(false);
    }
  }, []);

  const handleDynamoFullHistory = useCallback(async (): Promise<void> => {
    setDynamoHistoryError(null);
    setDynamoHistoryTriggering(true);
    try {
      const res = await fetch("/api/datamapping/full-history", { method: "POST" });
      const text = await res.text();
      let data: { ok?: boolean; error?: string } = {};
      try {
        data = JSON.parse(text) as { ok?: boolean; error?: string };
      } catch {
        if (text.includes("524") || text.toLowerCase().includes("timeout")) {
          setDynamoHistoryError(
            "Timeout: el servidor tardó demasiado en responder (524). Intenta de nuevo."
          );
        } else {
          setDynamoHistoryError("Error del servidor. Intenta de nuevo.");
        }
        return;
      }
      if (!res.ok || !data.ok) {
        setDynamoHistoryError(
          formatErrorMessage(data.error) || "Error al iniciar job"
        );
      }
    } catch (err) {
      setDynamoHistoryError(
        formatErrorMessage(err instanceof Error ? err.message : String(err)) ||
          "Error al iniciar job"
      );
    } finally {
      setDynamoHistoryTriggering(false);
    }
  }, []);

  const handleDatamappingSyncByMonths = useCallback(async (): Promise<void> => {
    setDynamoReextractError(null);
    setDynamoSyncByMonthsTriggering(true);
    try {
      if (datamappingRangeStart > datamappingRangeEnd) {
        setDynamoReextractError("Fecha inicio debe ser anterior o igual a Fecha fin");
        setDynamoSyncByMonthsTriggering(false);
        return;
      }
      const res = await fetch("/api/datamapping/sync-by-months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: datamappingRangeStart,
          endDate: datamappingRangeEnd,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setDynamoReextractError(data.error ?? "Error al iniciar job");
      }
    } catch (err) {
      setDynamoReextractError(
        err instanceof Error ? err.message : "Error al iniciar job"
      );
    } finally {
      setDynamoSyncByMonthsTriggering(false);
    }
  }, [datamappingRangeStart, datamappingRangeEnd]);

  const handleDatamappingIncremental = useCallback(async (): Promise<void> => {
    setDynamoIncrementalError(null);
    setDynamoIncrementalTriggering(true);
    try {
      const res = await fetch("/api/datamapping/incremental", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setDynamoIncrementalError(data.error ?? "Error al iniciar job");
      }
    } catch (err) {
      setDynamoIncrementalError(
        err instanceof Error ? err.message : "Error al iniciar job"
      );
    } finally {
      setDynamoIncrementalTriggering(false);
    }
  }, []);

  const handleClearDatamapping = useCallback(async (): Promise<void> => {
    setDynamoClearTriggering(true);
    setDynamoError(null);
    setDynamoDeleteDialogOpen(false);
    try {
      const res = await fetch("/api/datamapping/clear", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar borrado");
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar borrado"
      );
    } finally {
      setDynamoClearTriggering(false);
    }
  }, []);

  const handleLoadFromDateInngest = useCallback(async (): Promise<void> => {
    setLoadFromDateInngestJobId(null);
    setDynamoError(null);
    setLoadFromDateInngestTriggering(true);
    try {
      const res = await fetch("/api/datamapping/load-from-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDate: dynamoSinceDate }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: Id<"pipelineJobs">;
      };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar carga desde fecha");
      } else if (data.jobId) {
        setLoadFromDateInngestJobId(data.jobId);
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar carga desde fecha"
      );
    } finally {
      setLoadFromDateInngestTriggering(false);
    }
  }, [dynamoSinceDate]);

  const handleFechaTransaccionFullInngest = useCallback(async (): Promise<void> => {
    setFechaTransaccionFullInngestTriggering(true);
    try {
      const res = await fetch("/api/datamapping/fecha-transaccion-full", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: Id<"pipelineJobs">;
      };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar backfill fechaTransaccion");
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar backfill fechaTransaccion"
      );
    } finally {
      setFechaTransaccionFullInngestTriggering(false);
    }
  }, []);

  const handleFechaTransaccionRangeInngest = useCallback(async (): Promise<void> => {
    setFechaTransaccionRangeTriggering(true);
    try {
      const res = await fetch("/api/datamapping/fecha-transaccion-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: fechaTransaccionRangeStart,
          endDate: fechaTransaccionRangeEnd,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: Id<"pipelineJobs">;
        range?: string;
      };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar backfill fechaTransaccion");
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar backfill fechaTransaccion"
      );
    } finally {
      setFechaTransaccionRangeTriggering(false);
    }
  }, [fechaTransaccionRangeStart, fechaTransaccionRangeEnd]);

  const handleFechaTransaccionFromDateInngest = useCallback(async (): Promise<void> => {
    setFechaTransaccionFromDateInngestJobId(null);
    setFechaTransaccionFromDateInngestTriggering(true);
    try {
      const res = await fetch("/api/datamapping/fecha-transaccion-from-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDate: fechaTransaccionSinceDate }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        jobId?: Id<"pipelineJobs">;
      };
      if (!res.ok || !data.ok) {
        setDynamoError(data.error ?? "Error al iniciar backfill fechaTransaccion");
      } else if (data.jobId) {
        setFechaTransaccionFromDateInngestJobId(data.jobId);
      }
    } catch (err) {
      setDynamoError(
        err instanceof Error ? err.message : "Error al iniciar backfill fechaTransaccion"
      );
    } finally {
      setFechaTransaccionFromDateInngestTriggering(false);
    }
  }, [fechaTransaccionSinceDate]);

  const handleEnrichmentByMonths = useCallback(async (): Promise<void> => {
    setEnrichmentByMonthsError(null);
    setEnrichmentByMonthsTriggering(true);
    try {
      if (enrichmentByMonthsStart > enrichmentByMonthsEnd) {
        setEnrichmentByMonthsError("Mes inicio debe ser anterior o igual a mes fin (YYYY-MM)");
        setEnrichmentByMonthsTriggering(false);
        return;
      }
      const res = await fetch("/api/datamapping/enrich-by-months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: enrichmentByMonthsStart,
          end: enrichmentByMonthsEnd,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setEnrichmentByMonthsError(data.error ?? "Error al iniciar enriquecimiento por meses");
      }
    } catch (err) {
      setEnrichmentByMonthsError(
        err instanceof Error ? err.message : "Error al iniciar enriquecimiento por meses"
      );
    } finally {
      setEnrichmentByMonthsTriggering(false);
    }
  }, [enrichmentByMonthsStart, enrichmentByMonthsEnd]);

  const handleCalcularPendientesEnriquecimiento = useCallback(async (): Promise<void> => {
    setEnrichmentPendingCountError(null);
    setEnrichmentPendingCountResult(null);
    setEnrichmentPendingCountLoading(true);
    try {
      const months = generateMonthRange(enrichmentByMonthsStart, enrichmentByMonthsEnd);
      const res = await getPendingEnrichmentCountByMonths({ months });
      setEnrichmentPendingCountResult({
        counts: res.counts,
        ...(res.truncated != null && res.truncated.length > 0 ? { truncated: res.truncated } : {}),
      });
    } catch (err) {
      setEnrichmentPendingCountError(
        err instanceof Error ? err.message : "Error al calcular pendientes"
      );
    } finally {
      setEnrichmentPendingCountLoading(false);
    }
  }, [enrichmentByMonthsStart, enrichmentByMonthsEnd, getPendingEnrichmentCountByMonths]);

  const datamappingJobInProgress =
    latestDatamappingClearJob?.status === "pending" ||
    latestDatamappingClearJob?.status === "running" ||
    latestDatamappingFullHistoryJob?.status === "pending" ||
    latestDatamappingFullHistoryJob?.status === "running" ||
    latestFechaTransaccionFullJob?.status === "pending" ||
    latestFechaTransaccionFullJob?.status === "running" ||
    latestDatamappingSyncByMonthsJob?.status === "pending" ||
    latestDatamappingSyncByMonthsJob?.status === "running" ||
    latestDatamappingSyncByRangeJob?.status === "pending" ||
    latestDatamappingSyncByRangeJob?.status === "running" ||
    latestDatamappingLoadFromDateJob?.status === "pending" ||
    latestDatamappingLoadFromDateJob?.status === "running" ||
    latestDatamappingIncrementalJob?.status === "pending" ||
    latestDatamappingIncrementalJob?.status === "running" ||
    latestDatamappingEnrichmentByMonthsJob?.status === "pending" ||
    latestDatamappingEnrichmentByMonthsJob?.status === "running";

  const latestCloudWatchJobByMonths =
    cloudwatchDeterministicMode
      ? latestCloudwatchDeterministicSyncByMonthsJob
      : latestCloudWatchSyncByMonthsJob;
  const latestCloudWatchJobByRange =
    cloudwatchDeterministicMode
      ? latestCloudwatchDeterministicSyncByRangeJob
      : latestCloudwatchSyncByRangeJob;

  const cloudWatchJobByMonthsRunning =
    latestCloudWatchSyncByMonthsJob?.status === "running" ||
    latestCloudWatchSyncByMonthsJob?.status === "pending" ||
    latestCloudwatchDeterministicSyncByMonthsJob?.status === "running" ||
    latestCloudwatchDeterministicSyncByMonthsJob?.status === "pending";
  const cloudWatchJobByRangeRunning =
    latestCloudwatchSyncByRangeJob?.status === "running" ||
    latestCloudwatchSyncByRangeJob?.status === "pending" ||
    latestCloudwatchDeterministicSyncByRangeJob?.status === "running" ||
    latestCloudwatchDeterministicSyncByRangeJob?.status === "pending";

  const busy =
    datamappingJobInProgress ||
    latestCloudwatchIncrementalJob?.status === "pending" ||
    latestCloudwatchIncrementalJob?.status === "running" ||
    latestCloudwatchClearJob?.status === "pending" ||
    latestCloudwatchClearJob?.status === "running" ||
    cloudWatchJobByMonthsRunning ||
    cloudWatchJobByRangeRunning;

  return (
    <div className="p-6 md:p-8" suppressHydrationWarning>
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-space-grotesk gradient-text-emerald">
            Carga de fuentes
          </h1>
          <p className="text-muted-foreground mt-1">
            Sincroniza CloudWatch y Datamapping (DynamoDB). El estado de los jobs
            se puede ver en{" "}
            <Link
              href="/configuracion/status"
              className="text-emerald-400 hover:text-emerald-300 font-medium"
            >
              Status de actualizaciones
            </Link>
            .
          </p>
        </div>

        {/* CloudWatch (paymentRecords) — 5 secciones equivalentes a DataMapping */}
        <div className="glass-card rounded-xl p-6 space-y-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <RefreshCw className="size-5" />
            CloudWatch (paymentRecords)
            <Link
              href="/reconciliacion/diferencias-fuentes"
              className="text-sm font-normal text-emerald-400 hover:text-emerald-300 ml-auto"
            >
              Reconciliar →
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground">
            Extrae datos de CloudWatch Logs (v1, v2, payment). Dedup por referencia. Todos los jobs se ejecutan en Convex. Ver avance en Status de actualizaciones.
          </p>
          <div className="flex flex-col gap-2 rounded-lg border border-slate-600/50 bg-slate-800/30 px-4 py-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cloudwatchDeterministicMode}
                onChange={(e) => setCloudwatchDeterministicMode(e.target.checked)}
                className="rounded border-slate-500 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
              />
              <span className="text-sm font-medium">Modo determinístico (conteo por hora, tablas fuente, verificación)</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Los datos se escriben en tablas fuente (cloudwatchSourceV1/V2/Payment). Para tener paymentRecords hay que ejecutar después la consolidación (bloque más abajo).
            </p>
          </div>
          {(cloudWatchJobByMonthsRunning ||
            cloudWatchJobByRangeRunning ||
            latestCloudwatchIncrementalJob?.status === "running" ||
            latestCloudwatchIncrementalJob?.status === "pending" ||
            latestCloudwatchClearJob?.status === "running" ||
            latestCloudwatchClearJob?.status === "pending") && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <span className="text-sm text-amber-200/90">Job de CloudWatch en curso.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCancelCloudwatchJob}
                className="gap-1.5 border-amber-500/50 text-amber-200 hover:bg-amber-500/20"
              >
                <StopCircle className="size-3.5" />
                Cancelar job
              </Button>
            </div>
          )}

          {/* 1. Carga completa (desde 2024-01-01) */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/80 text-xs font-semibold text-white" aria-hidden>1</span>
              <h3 className="text-sm font-medium">Carga completa (desde 2024-01-01)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: extrae todo el rango desde enero 2024 hasta el fin del período. Un job por mes en paralelo.
            </p>
            <Button
              size="sm"
              variant="default"
              onClick={handleCloudWatchFull}
              disabled={cloudwatchFullTriggering || cloudWatchJobByMonthsRunning}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {cloudwatchFullTriggering ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Iniciando job...
                </>
              ) : latestCloudWatchJobByMonths?.status === "running" ||
                latestCloudWatchJobByMonths?.status === "pending" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  En curso ({latestCloudWatchJobByMonths.progress?.current ?? 0}/{latestCloudWatchJobByMonths.progress?.total ?? "?"} rangos)
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" />
                  Ejecutar job
                </>
              )}
            </Button>
            {latestCloudWatchJobByMonths?.status === "running" && (
              <div className="space-y-1">
                <Progress
                  value={
                    latestCloudWatchJobByMonths.progress?.total != null &&
                    latestCloudWatchJobByMonths.progress?.total > 0
                      ? ((latestCloudWatchJobByMonths.progress?.current ?? 0) /
                          latestCloudWatchJobByMonths.progress!.total!) *
                        100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {latestCloudWatchJobByMonths.progress?.message ??
                    `${latestCloudWatchJobByMonths.progress?.current ?? 0} de ${latestCloudWatchJobByMonths.progress?.total ?? "?"} rangos (3 días c/u)`}
                </p>
              </div>
            )}
            {latestCloudWatchJobByMonths?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestCloudWatchJobByMonths.result != null &&
                  typeof latestCloudWatchJobByMonths.result === "object" &&
                  "totalInserted" in latestCloudWatchJobByMonths.result
                    ? cloudwatchDeterministicMode
                      ? `${(latestCloudWatchJobByMonths.result as { totalInserted: number }).totalInserted} insertados (tablas fuente)`
                      : `${(latestCloudWatchJobByMonths.result as { totalInserted: number }).totalInserted} insertados, ${(latestCloudWatchJobByMonths.result as { totalDeleted?: number }).totalDeleted ?? 0} eliminados`
                    : "Completado"}
                </p>
                {(() => {
                  const r = latestCloudWatchJobByMonths?.result as { failedMonths?: { ym: string }[] } | undefined;
                  return r?.failedMonths?.length ? true : false;
                })() && (
                    <p className="mt-1 text-xs text-amber-400">
                      Meses fallidos:{" "}
                      {((latestCloudWatchJobByMonths?.result) as { failedMonths: { ym: string }[] } | undefined)?.failedMonths?.map((f) => f.ym).join(", ") ?? ""}
                    </p>
                  )}
              </div>
            )}
            {latestCloudWatchJobByMonths?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestCloudWatchJobByMonths.errorMessage)}
                </p>
              </div>
            )}
            {cloudwatchSyncByMonthsError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(cloudwatchSyncByMonthsError)}
              </div>
            )}
          </div>

          {/* 2. Carga por rango */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>2</span>
              <h3 className="text-sm font-medium">Carga por rango</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: una unidad por día en el rango; hasta 6 días en paralelo. Elige fecha de inicio y fecha de fin.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Fecha inicio</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  min={PERIOD_START_DATE}
                  max={PERIOD_END_DATE}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Fecha fin</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={PERIOD_START_DATE}
                  max={PERIOD_END_DATE}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCloudWatchSyncByMonths}
                disabled={cloudwatchSyncByMonthsTriggering || cloudWatchJobByRangeRunning}
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {cloudwatchSyncByMonthsTriggering ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Iniciando job...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Ejecutar job
                  </>
                )}
              </Button>
            </div>
            {latestCloudWatchJobByRange?.status === "running" && (
              <div className="space-y-1">
                <Progress
                  value={
                    latestCloudWatchJobByRange.progress?.total != null &&
                    latestCloudWatchJobByRange.progress?.total > 0
                      ? ((latestCloudWatchJobByRange.progress?.current ?? 0) /
                          latestCloudWatchJobByRange.progress!.total!) *
                        100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {latestCloudWatchJobByRange.progress?.current ?? 0} de {latestCloudWatchJobByRange.progress?.total ?? "?"} días
                </p>
              </div>
            )}
            {latestCloudWatchJobByRange?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestCloudWatchJobByRange.result != null &&
                  typeof latestCloudWatchJobByRange.result === "object" &&
                  "totalInserted" in latestCloudWatchJobByRange.result
                    ? cloudwatchDeterministicMode
                      ? `${(latestCloudWatchJobByRange.result as { totalInserted: number }).totalInserted} insertados (tablas fuente)`
                      : `${(latestCloudWatchJobByRange.result as { totalInserted: number }).totalInserted} insertados, ${(latestCloudWatchJobByRange.result as { totalDeleted?: number }).totalDeleted ?? 0} eliminados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestCloudWatchJobByRange?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestCloudWatchJobByRange.errorMessage)}
                </p>
              </div>
            )}
            {cloudwatchSyncByMonthsError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(cloudwatchSyncByMonthsError)}
              </div>
            )}
          </div>

          {/* 3. Carga desde fecha */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>3</span>
              <h3 className="text-sm font-medium">Carga desde fecha</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: extrae desde el mes de la fecha indicada hasta el fin del período.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Desde fecha</label>
                <input
                  type="date"
                  value={cloudwatchFromDate}
                  onChange={(e) => setCloudwatchFromDate(e.target.value)}
                  min={PERIOD_START_DATE}
                  max={PERIOD_END_DATE}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCloudWatchFromDate}
                disabled={
                  cloudwatchFromDateTriggering ||
                  cloudWatchJobByMonthsRunning ||
                  cloudWatchJobByRangeRunning
                }
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {cloudwatchFromDateTriggering ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Iniciando job...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Ejecutar job
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* 4. Incremental (mantener al día) */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>4</span>
              <h3 className="text-sm font-medium">Incremental (mantener al día)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: sincroniza desde la última marca de agua hasta hoy (México). La marca se actualiza al completar Carga completa, por meses o desde fecha.
            </p>
            {cloudwatchWatermark?.lastSyncedDate ? (
              <p className="text-xs text-muted-foreground rounded bg-slate-800/50 px-2 py-1 font-mono">
                Última fecha sincronizada: {cloudwatchWatermark.lastSyncedDate}
              </p>
            ) : (
              <p className="text-xs text-amber-400/90 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1">
                No hay marca de agua. Ejecuta primero &quot;1. Carga completa&quot;, &quot;2. Carga por rango&quot; o &quot;3. Carga desde fecha&quot;.
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleCloudwatchIncremental}
              disabled={
                cloudwatchIncrementalTriggering ||
                latestCloudwatchIncrementalJob?.status === "running" ||
                latestCloudwatchIncrementalJob?.status === "pending" ||
                cloudWatchJobByMonthsRunning ||
                cloudWatchJobByRangeRunning
              }
              className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
            >
              {cloudwatchIncrementalTriggering ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Iniciando job...
                </>
              ) : latestCloudwatchIncrementalJob?.status === "running" ||
                latestCloudwatchIncrementalJob?.status === "pending" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  En curso...
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" />
                  Ejecutar job
                </>
              )}
            </Button>
            {latestCloudwatchIncrementalJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestCloudwatchIncrementalJob.result != null &&
                  typeof latestCloudwatchIncrementalJob.result === "object" &&
                  "daysProcessed" in latestCloudwatchIncrementalJob.result
                    ? `${(latestCloudwatchIncrementalJob.result as { daysProcessed: number }).daysProcessed} días, ${(latestCloudwatchIncrementalJob.result as { inserted: number }).inserted} insertados, ${(latestCloudwatchIncrementalJob.result as { deleted: number }).deleted} eliminados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestCloudwatchIncrementalJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestCloudwatchIncrementalJob.errorMessage)}
                </p>
              </div>
            )}
            {cloudwatchIncrementalError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(cloudwatchIncrementalError)}
              </div>
            )}
          </div>

          {/* 5. Consolidar a paymentRecords (solo tras sync determinístico) */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>5</span>
              <h3 className="text-sm font-medium">Consolidar a paymentRecords (solo tras sync determinístico)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Une las tablas fuente (cloudwatchSourceV1/V2/Payment) en paymentRecords para el rango indicado. Ejecutar después de un sync determinístico.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Desde fecha</label>
                <input
                  type="date"
                  value={consolidateFromDate}
                  onChange={(e) => setConsolidateFromDate(e.target.value)}
                  min={PERIOD_START_DATE}
                  max={PERIOD_END_DATE}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Hasta fecha</label>
                <input
                  type="date"
                  value={consolidateToDate}
                  onChange={(e) => setConsolidateToDate(e.target.value)}
                  min={PERIOD_START_DATE}
                  max={PERIOD_END_DATE}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCloudwatchConsolidate}
                disabled={consolidateTriggering}
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {consolidateTriggering ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Ejecutando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Ejecutar consolidación
                  </>
                )}
              </Button>
            </div>
            {consolidateSuccess && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                {consolidateSuccess}
              </div>
            )}
            {consolidateError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(consolidateError)}
              </div>
            )}
          </div>

          {/* 6. Borrar datos */}
          <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-900/80 text-xs font-semibold text-red-200" aria-hidden>6</span>
              <h3 className="text-sm font-medium text-red-200/90">Borrar datos</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: elimina paymentRecords, monthStats y marca de agua. Requiere doble confirmación. Ver avance en Status de actualizaciones.
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedMonthRegistros && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCloudwatchClearError(null);
                    setRegistrosDeleteMonthDialogOpen(true);
                  }}
                  disabled={
                    latestCloudwatchClearJob?.status === "running" ||
                    latestCloudwatchClearJob?.status === "pending"
                  }
                  className="gap-2 border-red-900/50 bg-red-950/30 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                >
                  <Trash2 className="size-3.5" />
                  Borrar mes {selectedMonthRegistros}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCloudwatchClearError(null);
                  setRegistrosDeleteAllDialogOpen(true);
                }}
                disabled={
                  latestCloudwatchClearJob?.status === "running" ||
                  latestCloudwatchClearJob?.status === "pending"
                }
                className="gap-2 border-red-900/50 bg-red-950/30 text-red-400 hover:text-red-300 hover:bg-red-900/20"
              >
                <Trash2 className="size-3.5" />
                Borrar todo
              </Button>
            </div>
            {latestCloudwatchClearJob?.status === "running" && (
              <div className="space-y-1">
                <Progress value={100} className="h-2" />
                <p className="text-xs text-muted-foreground">Borrando...</p>
              </div>
            )}
            {latestCloudwatchClearJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestCloudwatchClearJob.result != null &&
                  typeof latestCloudwatchClearJob.result === "object" &&
                  "totalDeleted" in latestCloudwatchClearJob.result
                    ? `${(latestCloudwatchClearJob.result as { totalDeleted: number }).totalDeleted} registros eliminados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestCloudwatchClearJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestCloudwatchClearJob.errorMessage)}
                </p>
              </div>
            )}
            {cloudwatchClearError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(cloudwatchClearError)}
              </div>
            )}
          </div>
        </div>

        {/* Datamapping (DynamoDB) — 5 secciones equivalentes a CloudWatch + Backfill */}
        <div className="glass-card rounded-xl p-6 space-y-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="size-5" />
            Datamapping (DynamoDB)
            <Link
              href="/reconciliacion/diferencias-fuentes"
              className="text-sm font-normal text-emerald-400 hover:text-emerald-300 ml-auto"
            >
              Reconciliar →
            </Link>
          </h2>
          <p className="text-sm text-muted-foreground">
            Datamapping por updatedAt (todos los status). Upsert por referencia. Todos los jobs se ejecutan en Convex. Ver avance en Status de actualizaciones.
          </p>

          {datamappingJobInProgress && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <span className="text-sm text-amber-200/90">Job de DataMapping (DynamoDB) en curso.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCancelDatamappingJob}
                className="gap-1.5 border-amber-500/50 text-amber-200 hover:bg-amber-500/20"
              >
                <StopCircle className="size-3.5" />
                Cancelar job
              </Button>
            </div>
          )}

          {/* 1. Carga completa (desde 2024-01-01) */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/80 text-xs font-semibold text-white" aria-hidden>1</span>
              <h3 className="text-sm font-medium">Carga completa (desde 2024-01-01)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: extrae toda la historia desde enero 2024. Unidades por rango de días por mes.
            </p>
            <Button
              size="sm"
              variant="default"
              onClick={handleDynamoFullHistory}
              disabled={dynamoHistoryTriggering || busy}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {dynamoHistoryTriggering ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Iniciando job...
                </>
              ) : latestDatamappingFullHistoryJob?.status === "running" ||
                latestDatamappingFullHistoryJob?.status === "pending" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  En curso ({latestDatamappingFullHistoryJob.progress?.current ?? 0}/{latestDatamappingFullHistoryJob.progress?.total ?? "?"} unidades)
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" />
                  Ejecutar job
                </>
              )}
            </Button>
            {latestDatamappingFullHistoryJob?.status === "running" && (
              <div className="space-y-2">
                <Progress
                  value={
                    latestDatamappingFullHistoryJob.progress?.total != null &&
                    latestDatamappingFullHistoryJob.progress?.total > 0
                      ? ((latestDatamappingFullHistoryJob.progress?.current ?? 0) /
                          latestDatamappingFullHistoryJob.progress!.total!) *
                        100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {latestDatamappingFullHistoryJob.progress?.message ??
                    `Procesando ${latestDatamappingFullHistoryJob.progress?.total ?? "?"} unidades...`}
                </p>
              </div>
            )}
            {latestDatamappingFullHistoryJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingFullHistoryJob.result != null &&
                  typeof latestDatamappingFullHistoryJob.result === "object" &&
                  "totalInserted" in latestDatamappingFullHistoryJob.result &&
                  "totalUpdated" in latestDatamappingFullHistoryJob.result
                    ? `${(latestDatamappingFullHistoryJob.result as { totalInserted: number }).totalInserted} insertados, ${(latestDatamappingFullHistoryJob.result as { totalUpdated: number }).totalUpdated} actualizados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestDatamappingFullHistoryJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestDatamappingFullHistoryJob.errorMessage)}
                </p>
              </div>
            )}
            {dynamoHistoryError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(dynamoHistoryError)}
              </div>
            )}
          </div>

          {/* 2. Carga por rango */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>2</span>
              <h3 className="text-sm font-medium">Carga por rango</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: una unidad por día en el rango; hasta 6 días en paralelo. Elige fecha de inicio y fecha de fin.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Fecha inicio</label>
                <input
                  type="date"
                  value={datamappingRangeStart}
                  onChange={(e) => setDatamappingRangeStart(e.target.value)}
                  min={DATAMAPPING_HISTORY_START}
                  max={PERIOD_END_DATE}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Fecha fin</label>
                <input
                  type="date"
                  value={datamappingRangeEnd}
                  onChange={(e) => setDatamappingRangeEnd(e.target.value)}
                  min={DATAMAPPING_HISTORY_START}
                  max={PERIOD_END_DATE}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDatamappingSyncByMonths}
                disabled={
                  dynamoSyncByMonthsTriggering ||
                  busy ||
                  latestDatamappingSyncByRangeJob?.status === "running" ||
                  latestDatamappingSyncByRangeJob?.status === "pending"
                }
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {dynamoSyncByMonthsTriggering ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Iniciando job...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Ejecutar job
                  </>
                )}
              </Button>
            </div>
            {latestDatamappingSyncByRangeJob?.status === "running" && (
              <div className="space-y-1">
                <Progress
                  value={
                    latestDatamappingSyncByRangeJob.progress?.total != null &&
                    latestDatamappingSyncByRangeJob.progress?.total > 0
                      ? ((latestDatamappingSyncByRangeJob.progress?.current ?? 0) /
                          latestDatamappingSyncByRangeJob.progress!.total!) *
                        100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {latestDatamappingSyncByRangeJob.progress?.current ?? 0} de {latestDatamappingSyncByRangeJob.progress?.total ?? "?"} días
                </p>
              </div>
            )}
            {latestDatamappingSyncByRangeJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingSyncByRangeJob.result != null &&
                  typeof latestDatamappingSyncByRangeJob.result === "object" &&
                  "totalInserted" in latestDatamappingSyncByRangeJob.result
                    ? `${(latestDatamappingSyncByRangeJob.result as { totalInserted: number }).totalInserted} insertados, ${(latestDatamappingSyncByRangeJob.result as { totalUpdated: number }).totalUpdated} actualizados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestDatamappingSyncByRangeJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestDatamappingSyncByRangeJob.errorMessage)}
                </p>
              </div>
            )}
            {dynamoReextractError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(dynamoReextractError)}
              </div>
            )}
          </div>

          {/* 3. Carga desde fecha */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>3</span>
              <h3 className="text-sm font-medium">Carga desde fecha</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: registros con updatedAt posterior a la fecha indicada.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">updatedAt posterior a</label>
                <input
                  type="date"
                  value={dynamoSinceDate}
                  onChange={(e) => setDynamoSinceDate(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleLoadFromDateInngest}
                disabled={loadFromDateInngestTriggering || busy}
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {loadFromDateInngestTriggering ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Iniciando job...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Ejecutar job
                  </>
                )}
              </Button>
            </div>
            {latestDatamappingLoadFromDateJob?.status === "running" && (
              <div className="space-y-1">
                <Progress
                  value={100}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">Procesando...</p>
              </div>
            )}
            {latestDatamappingLoadFromDateJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingLoadFromDateJob.result != null &&
                  typeof latestDatamappingLoadFromDateJob.result === "object" &&
                  "inserted" in latestDatamappingLoadFromDateJob.result
                    ? `${(latestDatamappingLoadFromDateJob.result as { inserted: number }).inserted} insertados, ${(latestDatamappingLoadFromDateJob.result as { updated: number }).updated} actualizados`
                    : "Completado"}
                </p>
              </div>
            )}
            {(loadFromDateInngestJobId ?? latestDatamappingLoadFromDateJob) && (
              <p className="text-xs text-muted-foreground">
                Ver en{" "}
                <Link href="/configuracion/status" className="text-emerald-400 hover:text-emerald-300">
                  Status de actualizaciones
                </Link>
              </p>
            )}
            {dynamoError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(dynamoError)}
              </div>
            )}
          </div>

          {/* 4. Incremental (mantener al día) */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>4</span>
              <h3 className="text-sm font-medium">Incremental (mantener al día)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: trae solo cambios desde la última marca de agua (updatedAt). Ideal tras la carga inicial.
            </p>
            {datamappingWatermark?.lastUpdatedAt ? (
              <p className="text-xs text-muted-foreground rounded bg-slate-800/50 px-2 py-1 font-mono">
                Marca actual: {datamappingWatermark.lastUpdatedAt}
              </p>
            ) : (
              <p className="text-xs text-amber-400/90 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1">
                No hay marca de agua. Ejecuta primero &quot;1. Carga completa&quot; o &quot;3. Carga desde fecha&quot;.
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleDatamappingIncremental}
              disabled={dynamoIncrementalTriggering || busy}
              className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
            >
              {dynamoIncrementalTriggering ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Iniciando job...
                </>
              ) : latestDatamappingIncrementalJob?.status === "running" ||
                latestDatamappingIncrementalJob?.status === "pending" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  En curso...
                </>
              ) : (
                <>
                  <RefreshCw className="size-3.5" />
                  Ejecutar job
                </>
              )}
            </Button>
            {latestDatamappingIncrementalJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingIncrementalJob.result != null &&
                  typeof latestDatamappingIncrementalJob.result === "object" &&
                  "processed" in latestDatamappingIncrementalJob.result
                    ? `${(latestDatamappingIncrementalJob.result as { processed: number }).processed} procesados (${(latestDatamappingIncrementalJob.result as { inserted: number }).inserted} ins, ${(latestDatamappingIncrementalJob.result as { updated: number }).updated} act)`
                    : "Completado"}
                </p>
              </div>
            )}
            {dynamoIncrementalError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(dynamoIncrementalError)}
              </div>
            )}
          </div>

          {/* 5. Borrar datos */}
          <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-900/80 text-xs font-semibold text-red-200" aria-hidden>5</span>
              <h3 className="text-sm font-medium text-red-200/90">Borrar datos</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Elimina todos los datamappingRecords, estadísticas y marca de agua. Requiere doble confirmación.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDynamoDeleteDialogOpen(true)}
              disabled={busy || dynamoClearTriggering}
              className="gap-2 border-red-900/50 bg-red-950/30 text-red-400 hover:text-red-300 hover:bg-red-900/20"
            >
              {dynamoClearTriggering ||
              latestDatamappingClearJob?.status === "pending" ||
              latestDatamappingClearJob?.status === "running" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Borrar todo (datamappingRecords)
            </Button>
            {latestDatamappingClearJob?.status === "running" && (
              <div className="space-y-2 w-full max-w-sm">
                <Progress
                  value={
                    latestDatamappingClearJob.progress?.total != null &&
                    latestDatamappingClearJob.progress?.total > 0
                      ? ((latestDatamappingClearJob.progress?.current ?? 0) /
                          latestDatamappingClearJob.progress!.total!) *
                        100
                      : 0
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {latestDatamappingClearJob.progress?.message ??
                    `Lote ${latestDatamappingClearJob.progress?.current ?? 0} de ${latestDatamappingClearJob.progress?.total ?? "?"}`}
                </p>
              </div>
            )}
            {latestDatamappingClearJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingClearJob.result != null &&
                  typeof latestDatamappingClearJob.result === "object" &&
                  "totalDeleted" in latestDatamappingClearJob.result
                    ? `${(latestDatamappingClearJob.result as { totalDeleted: number }).totalDeleted} registros eliminados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestDatamappingClearJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs">
                  {formatErrorMessage(latestDatamappingClearJob.errorMessage)}
                </p>
              </div>
            )}
          </div>

          {/* Enriquecimiento por meses (RFC, etc. desde rawJson) */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>—</span>
              <h3 className="text-sm font-medium">Enriquecimiento por meses</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Job en Convex: enriquece datamappingRecords (RFC, placa, status, etc.) desde rawJson por rango de meses (YYYY-MM). Una unidad por mes.
            </p>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Mes inicio (YYYY-MM)</label>
                <input
                  type="month"
                  value={enrichmentByMonthsStart}
                  onChange={(e) => setEnrichmentByMonthsStart(e.target.value.slice(0, 7))}
                  min={PERIOD_START}
                  max={PERIOD_END}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Mes fin (YYYY-MM)</label>
                <input
                  type="month"
                  value={enrichmentByMonthsEnd}
                  onChange={(e) => setEnrichmentByMonthsEnd(e.target.value.slice(0, 7))}
                  min={PERIOD_START}
                  max={PERIOD_END}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleEnrichmentByMonths}
                disabled={
                  enrichmentByMonthsTriggering ||
                  busy ||
                  latestDatamappingEnrichmentByMonthsJob?.status === "running" ||
                  latestDatamappingEnrichmentByMonthsJob?.status === "pending"
                }
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {enrichmentByMonthsTriggering ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Iniciando…
                  </>
                ) : latestDatamappingEnrichmentByMonthsJob?.status === "running" ||
                  latestDatamappingEnrichmentByMonthsJob?.status === "pending" ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    En curso ({latestDatamappingEnrichmentByMonthsJob.progress?.current ?? 0}/{latestDatamappingEnrichmentByMonthsJob.progress?.total ?? "?"})
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3.5" />
                    Ejecutar enriquecimiento
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCalcularPendientesEnriquecimiento}
                disabled={
                  enrichmentPendingCountLoading ||
                  latestDatamappingEnrichmentByMonthsJob?.status === "running" ||
                  latestDatamappingEnrichmentByMonthsJob?.status === "pending"
                }
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {enrichmentPendingCountLoading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Calculando…
                  </>
                ) : (
                  "Calcular pendientes"
                )}
              </Button>
            </div>
            {latestDatamappingEnrichmentByMonthsJob?.status === "running" && (
              <div className="space-y-1">
                <Progress
                  value={
                    latestDatamappingEnrichmentByMonthsJob.progress?.total != null &&
                    latestDatamappingEnrichmentByMonthsJob.progress?.total > 0
                      ? ((latestDatamappingEnrichmentByMonthsJob.progress?.current ?? 0) /
                          latestDatamappingEnrichmentByMonthsJob.progress!.total!) *
                        100
                      : 0
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {latestDatamappingEnrichmentByMonthsJob.progress?.message ??
                    `Mes ${latestDatamappingEnrichmentByMonthsJob.progress?.current ?? 0} de ${latestDatamappingEnrichmentByMonthsJob.progress?.total ?? "?"}`}
                </p>
                {enrichmentJobUnits != null && enrichmentJobUnits.length > 0 && (
                  <ul className="text-xs text-slate-400 mt-2 space-y-0.5">
                    {enrichmentJobUnits
                      .filter((u) => u.status === "running" && u.progressDetail != null)
                      .map((u) => (
                        <li key={u.unitId}>
                          <span className="font-mono text-slate-300">{u.unitId}</span>
                          {" — "}
                          {(u.progressDetail as { processed: number; enriched: number }).processed.toLocaleString()}{" "}
                          procesados,{" "}
                          {(u.progressDetail as { processed: number; enriched: number }).enriched.toLocaleString()}{" "}
                          enriquecidos
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
            {enrichmentPendingCountResult != null && !enrichmentPendingCountLoading && (
              <div className="rounded-lg bg-slate-800/50 border border-slate-600/50 p-3 text-sm">
                <p className="font-medium text-slate-300 mb-1">Registros pendientes por mes</p>
                <p className="text-xs text-slate-400">
                  {Object.entries(enrichmentPendingCountResult.counts)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([month, count]) => `${month}: ${count.toLocaleString()}`)
                    .join("; ")}
                </p>
                {enrichmentPendingCountResult.truncated != null &&
                  enrichmentPendingCountResult.truncated.length > 0 && (
                    <p className="text-amber-400/90 text-xs mt-1">
                      Meses con más de 100.000 registros (valor mostrado es tope):{" "}
                      {enrichmentPendingCountResult.truncated.join(", ")}
                    </p>
                  )}
              </div>
            )}
            {enrichmentPendingCountError != null && !enrichmentPendingCountLoading && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {enrichmentPendingCountError}
              </div>
            )}
            {latestDatamappingEnrichmentByMonthsJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestDatamappingEnrichmentByMonthsJob.result != null &&
                  typeof latestDatamappingEnrichmentByMonthsJob.result === "object" &&
                  "totalProcessed" in latestDatamappingEnrichmentByMonthsJob.result
                    ? (() => {
                        const r = latestDatamappingEnrichmentByMonthsJob.result as {
                          totalProcessed: number;
                          totalEnriched: number;
                        };
                        if (r.totalProcessed === 0 && r.totalEnriched === 0) {
                          return "Todo estaba ya enriquecido: no había registros con enrichmentExtracted = false en el rango.";
                        }
                        return `${r.totalProcessed} procesados, ${r.totalEnriched} enriquecidos`;
                      })()
                    : "Completado"}
                </p>
              </div>
            )}
            {latestDatamappingEnrichmentByMonthsJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs whitespace-pre-wrap break-words">
                  {formatErrorMessage(latestDatamappingEnrichmentByMonthsJob.errorMessage)}
                </p>
              </div>
            )}
            {enrichmentByMonthsError && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {formatErrorMessage(enrichmentByMonthsError)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Ver avance en{" "}
              <Link href="/configuracion/status" className="text-emerald-400 hover:text-emerald-300">
                Status de actualizaciones
              </Link>
              {" o "}
              <Link href="/operaciones/runs" className="text-emerald-400 hover:text-emerald-300">
                Operaciones → Runs
              </Link>
              .
            </p>
          </div>

          {/* 6. Backfill fechaTransaccion (solo DataMapping) */}
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold text-slate-200" aria-hidden>—</span>
              <h3 className="text-sm font-medium">Backfill fechaTransaccion</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Solo DataMapping. Llena fechaTransaccion desde paymentRecords (por referencia); fallback a updatedAt. Job en Convex.
            </p>
            {/* Opción 1: Todo el período — sin fecha */}
            <div className="space-y-2 rounded-md border border-slate-700/40 bg-slate-800/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Todo el período (todos los meses)
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleFechaTransaccionFullInngest}
                disabled={fechaTransaccionFullInngestTriggering || busy}
                className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
              >
                {fechaTransaccionFullInngestTriggering ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Ejecutar job: Todos los meses
              </Button>
            </div>
            {/* Rango personalizado: solo los bloques en ese rango (para reintentar fallidos) */}
            <div className="space-y-2 rounded-md border border-slate-700/40 bg-slate-800/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Rango personalizado (para reintentar bloques fallidos)
              </p>
              <p className="text-xs text-muted-foreground">
                Ejecuta solo los bloques de 3 días entre las fechas. Ej.: 2024-07-01 a 2024-07-03, o 2025-08-16 a 2025-08-21.
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Desde</label>
                  <input
                    type="date"
                    value={fechaTransaccionRangeStart}
                    onChange={(e) => setFechaTransaccionRangeStart(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Hasta</label>
                  <input
                    type="date"
                    value={fechaTransaccionRangeEnd}
                    onChange={(e) => setFechaTransaccionRangeEnd(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleFechaTransaccionRangeInngest}
                  disabled={fechaTransaccionRangeTriggering || fechaTransaccionFullInngestTriggering || busy}
                  className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
                >
                  {fechaTransaccionRangeTriggering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Ejecutar solo este rango
                </Button>
              </div>
            </div>
            {/* Opción 2: Desde una fecha — fecha + botón */}
            <div className="space-y-2 rounded-md border border-slate-700/40 bg-slate-800/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Desde una fecha (updatedAt posterior a)
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground sr-only">Fecha</label>
                  <input
                    type="date"
                    value={fechaTransaccionSinceDate}
                    onChange={(e) => setFechaTransaccionSinceDate(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleFechaTransaccionFromDateInngest}
                  disabled={fechaTransaccionFromDateInngestTriggering || busy}
                  className="gap-2 border-slate-600 bg-slate-800/50 hover:bg-slate-700/50"
                >
                  {fechaTransaccionFromDateInngestTriggering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Ejecutar job: Desde fecha
                </Button>
              </div>
            </div>
            {latestFechaTransaccionFullJob?.status === "running" && (
              <div className="space-y-2 w-full max-w-sm">
                <Progress
                  value={
                    latestFechaTransaccionFullJob.progress?.total != null &&
                    latestFechaTransaccionFullJob.progress?.total > 0
                      ? ((latestFechaTransaccionFullJob.progress?.current ?? 0) /
                          latestFechaTransaccionFullJob.progress!.total!) *
                        100
                      : 0
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {latestFechaTransaccionFullJob.progress?.message ??
                    `Mes ${latestFechaTransaccionFullJob.progress?.current ?? 0} de ${latestFechaTransaccionFullJob.progress?.total ?? "?"}`}
                </p>
                {fechaTransaccionJobUnits != null && fechaTransaccionJobUnits.length > 0 && (
                  <ul className="text-xs text-slate-400 mt-2 space-y-0.5">
                    {fechaTransaccionJobUnits
                      .filter((u) => u.status === "running" && u.progressDetail != null)
                      .map((u) => {
                        const d = u.progressDetail as
                          | { processed: number; updated?: number }
                          | undefined;
                        return (
                          <li key={u.unitId}>
                            <span className="font-mono text-slate-300">{u.unitId}</span>
                            {d != null ? (
                              <>
                                {" — "}
                                {d.processed.toLocaleString()} procesados
                                {d.updated != null && (
                                  <>, {d.updated.toLocaleString()} actualizados</>
                                )}
                              </>
                            ) : null}
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            )}
            {latestFechaTransaccionFullJob?.status === "completed" && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-400">
                <p className="font-medium">Job completado</p>
                <p className="mt-1 text-xs">
                  {latestFechaTransaccionFullJob.result != null &&
                  typeof latestFechaTransaccionFullJob.result === "object" &&
                  "totalProcessed" in latestFechaTransaccionFullJob.result
                    ? `${(latestFechaTransaccionFullJob.result as { totalProcessed: number }).totalProcessed} procesados, ${(latestFechaTransaccionFullJob.result as { totalUpdated: number }).totalUpdated} actualizados`
                    : "Completado"}
                </p>
              </div>
            )}
            {latestFechaTransaccionFullJob?.status === "failed" && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                <p className="font-medium">Error</p>
                <p className="mt-1 text-xs">
                  {formatErrorMessage(latestFechaTransaccionFullJob.errorMessage)}
                </p>
              </div>
            )}
          </div>
          {dynamoError && (
            <div className="text-sm text-destructive">{formatErrorMessage(dynamoError)}</div>
          )}
        </div>
      </div>

      <Dialog
        open={dynamoDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDynamoDeleteStep(1);
            setDynamoDeleteConfirmText("");
          }
          setDynamoDeleteDialogOpen(open);
        }}
      >
        <DialogContent className="glass-card-elevated border-border/50">
          <DialogHeader>
            <DialogTitle>Borrar datamappingRecords</DialogTitle>
            <DialogDescription>
              {dynamoDeleteStep === 1 ? (
                <>
                  Se disparará un job que borrará <strong>todos</strong> los registros de
                  datamappingRecords, estadísticas y la marca de agua. Esta acción no se puede deshacer.
                  Podrás ver el avance en Status de actualizaciones y volver a cargar después.
                </>
              ) : (
                <>
                  Segunda confirmación: escribe <strong>{DELETE_CONFIRM_WORD}</strong> para confirmar el borrado completo.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {dynamoDeleteStep === 2 && (
            <div className="space-y-2 py-2">
              <input
                type="text"
                value={dynamoDeleteConfirmText}
                onChange={(e) => setDynamoDeleteConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRM_WORD}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            {dynamoDeleteStep === 1 ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDynamoDeleteStep(2);
                  }}
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Continuar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDynamoDeleteDialogOpen(false)}
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={handleClearDatamapping}
                  disabled={
                    dynamoDeleteConfirmText.trim() !== DELETE_CONFIRM_WORD ||
                    dynamoClearTriggering ||
                    latestDatamappingClearJob?.status === "pending" ||
                    latestDatamappingClearJob?.status === "running"
                  }
                  size="sm"
                >
                  {dynamoClearTriggering ||
                  latestDatamappingClearJob?.status === "pending" ||
                  latestDatamappingClearJob?.status === "running"
                    ? "Iniciando..."
                    : "Eliminar todo"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDynamoDeleteStep(1);
                    setDynamoDeleteConfirmText("");
                  }}
                  disabled={
                    dynamoClearTriggering ||
                    latestDatamappingClearJob?.status === "pending" ||
                    latestDatamappingClearJob?.status === "running"
                  }
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Atrás
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={registrosDeleteMonthDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteMonthStep(1);
            setDeleteMonthConfirmText("");
          }
          setRegistrosDeleteMonthDialogOpen(open);
        }}
      >
        <DialogContent className="glass-card-elevated border-border/50">
          <DialogHeader>
            <DialogTitle>Borrar mes {selectedMonthRegistros} (paymentRecords)</DialogTitle>
            <DialogDescription>
              {deleteMonthStep === 1 ? (
                <>
                  Se disparará un job que borrará paymentRecords y monthStats del mes {selectedMonthRegistros}.
                  Ver avance en Status de actualizaciones. Esta acción no se puede deshacer.
                </>
              ) : (
                <>
                  Segunda confirmación: escribe <strong>{DELETE_CONFIRM_WORD}</strong> para confirmar.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteMonthStep === 2 && (
            <div className="space-y-2 py-2">
              <input
                type="text"
                value={deleteMonthConfirmText}
                onChange={(e) => setDeleteMonthConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRM_WORD}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            {deleteMonthStep === 1 ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDeleteMonthStep(2)}
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Continuar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setRegistrosDeleteMonthDialogOpen(false)}
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={() =>
                    selectedMonthRegistros && handleCloudwatchClearMonth(selectedMonthRegistros)
                  }
                  disabled={
                    latestCloudwatchClearJob?.status === "running" ||
                    latestCloudwatchClearJob?.status === "pending" ||
                    !selectedMonthRegistros ||
                    deleteMonthConfirmText.trim() !== DELETE_CONFIRM_WORD
                  }
                  size="sm"
                >
                  {latestCloudwatchClearJob?.status === "running" ||
                  latestCloudwatchClearJob?.status === "pending"
                    ? "Iniciando job..."
                    : "Eliminar mes"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteMonthStep(1);
                    setDeleteMonthConfirmText("");
                  }}
                  disabled={
                    latestCloudwatchClearJob?.status === "running" ||
                    latestCloudwatchClearJob?.status === "pending"
                  }
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Atrás
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={registrosDeleteAllDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteAllStep(1);
            setDeleteAllConfirmText("");
          }
          setRegistrosDeleteAllDialogOpen(open);
        }}
      >
        <DialogContent className="glass-card-elevated border-border/50">
          <DialogHeader>
            <DialogTitle>Borrar todo (paymentRecords)</DialogTitle>
            <DialogDescription>
              {deleteAllStep === 1 ? (
                <>
                  Se disparará un job que borrará <strong>todos</strong> los paymentRecords y monthStats de {PERIOD_START} a {PERIOD_END}, y la marca de agua.
                  Ver avance en Status de actualizaciones. Esta acción no se puede deshacer.
                </>
              ) : (
                <>
                  Segunda confirmación: escribe <strong>{DELETE_CONFIRM_WORD}</strong> para confirmar el borrado completo.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteAllStep === 2 && (
            <div className="space-y-2 py-2">
              <input
                type="text"
                value={deleteAllConfirmText}
                onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRM_WORD}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            {deleteAllStep === 1 ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setDeleteAllStep(2)}
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Continuar
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setRegistrosDeleteAllDialogOpen(false)}
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={handleCloudwatchClearAll}
                  disabled={
                    latestCloudwatchClearJob?.status === "running" ||
                    latestCloudwatchClearJob?.status === "pending" ||
                    deleteAllConfirmText.trim() !== DELETE_CONFIRM_WORD
                  }
                  size="sm"
                >
                  {latestCloudwatchClearJob?.status === "running" ||
                  latestCloudwatchClearJob?.status === "pending"
                    ? "Iniciando job..."
                    : "Eliminar todo"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteAllStep(1);
                    setDeleteAllConfirmText("");
                  }}
                  disabled={
                    latestCloudwatchClearJob?.status === "running" ||
                    latestCloudwatchClearJob?.status === "pending"
                  }
                  size="sm"
                  className="bg-white/3 border-border/50"
                >
                  Atrás
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
