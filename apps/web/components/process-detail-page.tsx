"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ErrorCard } from "@/components/error-card";
import {
  AverageConfidenceValue,
  EstimatedCostValue,
  formatDateTime,
  JobStatusBadge,
  NeedsReviewBadge,
} from "@/components/job-history-ui";
import { PageLoadingState } from "@/components/page-loading-state";
import { useSession } from "@/components/providers/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadQueuePanel } from "@/components/upload-queue";
import { api, type BusinessProcess, type Job } from "@/lib/api";
import { getErrorMessage, showErrorToast } from "@/lib/errors";
import { confidenceThresholdFloatToPercent } from "@/lib/process-threshold";
import { getPollingInterval, pollingIntervals } from "@/lib/query";
import { queryKeys } from "@/lib/query-keys";
import { hasCapability } from "@/lib/roles";
import {
  createPendingQueueItem,
  createQueueItemId,
  FILE_INPUT_ACCEPT,
  isTerminalStatus,
  mapJobToQueueUpdate,
  MAX_FILES_PER_SELECTION,
  partitionSelection,
  UPLOAD_CONCURRENCY,
  type UploadQueueItem,
} from "@/lib/upload-queue";
import { cn } from "@/lib/utils";

const RECENT_JOBS_LIMIT = 5;

const processStatusStyles: Record<BusinessProcess["routingAnalyzerStatus"], string> = {
  building: "border-warning-border bg-warning-surface text-warning",
  ready: "border-success-border bg-success-surface text-success",
  failed: "border-destructive/20 bg-destructive/10 text-destructive",
};

const processStatusIcons: Record<BusinessProcess["routingAnalyzerStatus"], "sync" | "check_circle" | "error"> = {
  building: "sync",
  ready: "check_circle",
  failed: "error",
};

function formatStatusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getProcessPollingMessage(process: BusinessProcess) {
  if (process.routingAnalyzerStatus === "failed") {
    return process.routingAnalyzerError
      ? `Uploads are disabled because routing analyzer provisioning failed: ${process.routingAnalyzerError}`
      : "Uploads are disabled because routing analyzer provisioning failed.";
  }

  if (process.routingAnalyzerStatus === "building") {
    return "Uploads are disabled until the routing analyzer finishes provisioning.";
  }

  return null;
}

function DeleteProcessDialog({
  process,
  open,
  deleting,
  onCancel,
  onConfirm,
}: {
  process: BusinessProcess | null;
  open: boolean;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open || !process) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-process-title"
        className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl"
      >
        <div className="space-y-3">
          <h2 id="delete-process-title" className="text-xl font-semibold tracking-tight">
            Delete {process.name}?
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            This permanently deletes <span className="font-medium text-foreground">{process.name}</span>,
            along with all of its jobs and uploaded documents. This action cannot be undone.
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete process"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  tone,
  icon,
}: {
  status: string;
  tone: string;
  icon: "sync" | "check_circle" | "error";
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>
      <Icon name={icon} size={14} className={icon === "sync" ? "animate-spin" : undefined} />
      {status}
    </span>
  );
}

export function ProcessDetailPage({ processId }: { processId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const canWriteProcesses = hasCapability(user?.roleLabel, "processes:write");

  const [processPollingStartedAt, setProcessPollingStartedAt] = useState<string | null>(null);
  const [showAnalyzerManualRefresh, setShowAnalyzerManualRefresh] = useState(false);
  const [showQueueManualRefresh, setShowQueueManualRefresh] = useState(false);
  const [processToDelete, setProcessToDelete] = useState<BusinessProcess | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);

  const processQuery = useQuery({
    queryKey: queryKeys.processes.detail(processId),
    queryFn: () => api.getProcess(processId),
    refetchInterval: (query) => {
      const process = query.state.data as BusinessProcess | undefined;

      if (process?.routingAnalyzerStatus !== "building") {
        return false;
      }

      return getPollingInterval({
        startedAt: processPollingStartedAt,
        fastMs: pollingIntervals.analyzers.fastMs,
        slowMs: pollingIntervals.analyzers.slowMs,
      });
    },
  });

  const recentJobsQuery = useQuery({
    queryKey: [...queryKeys.jobs.all(processId), "preview", needsReviewOnly ? "needs-review" : "all"],
    queryFn: () =>
      api.listJobs(processId, {
        limit: RECENT_JOBS_LIMIT,
        hasViolations: needsReviewOnly ? true : undefined,
      }),
    enabled: processQuery.isSuccess,
  });

  const inFlightQueueItems = useMemo(
    () => queueItems.filter((item) => item.jobId !== null && !isTerminalStatus(item.status)),
    [queueItems],
  );

  const earliestInFlightStartedAt = useMemo(() => {
    return inFlightQueueItems.reduce<string | null>((earliest, item) => {
      if (!item.startedAt) {
        return earliest;
      }

      if (!earliest || new Date(item.startedAt).getTime() < new Date(earliest).getTime()) {
        return item.startedAt;
      }

      return earliest;
    }, null);
  }, [inFlightQueueItems]);

  const queueStatusLimit = Math.min(500, Math.max(inFlightQueueItems.length + 10, RECENT_JOBS_LIMIT));

  const queueStatusQuery = useQuery({
    queryKey: [...queryKeys.jobs.all(processId), "queue-status"],
    queryFn: () => api.listJobs(processId, { limit: queueStatusLimit }),
    enabled: inFlightQueueItems.length > 0,
    refetchInterval: () => {
      if (inFlightQueueItems.length === 0) {
        return false;
      }

      return getPollingInterval({
        startedAt: earliestInFlightStartedAt,
        fastMs: pollingIntervals.jobs.fastMs,
        slowMs: pollingIntervals.jobs.slowMs,
      });
    },
  });

  useEffect(() => {
    const status = processQuery.data?.routingAnalyzerStatus;

    if (status === "building" && processPollingStartedAt === null) {
      const timeoutId = window.setTimeout(() => {
        setProcessPollingStartedAt(new Date().toISOString());
        setShowAnalyzerManualRefresh(false);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    if (status !== "building" && processPollingStartedAt !== null) {
      const timeoutId = window.setTimeout(() => {
        setProcessPollingStartedAt(null);
        setShowAnalyzerManualRefresh(false);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [processPollingStartedAt, processQuery.data?.routingAnalyzerStatus]);

  useEffect(() => {
    if (!processPollingStartedAt || processQuery.data?.routingAnalyzerStatus !== "building") {
      return;
    }

    const elapsedMs = Date.now() - new Date(processPollingStartedAt).getTime();
    const remainingMs = pollingIntervals.timeoutMs - elapsedMs;

    const timeoutId = window.setTimeout(() => {
      setShowAnalyzerManualRefresh(true);
    }, Math.max(remainingMs, 0));

    return () => window.clearTimeout(timeoutId);
  }, [processPollingStartedAt, processQuery.data?.routingAnalyzerStatus]);

  // Reconciles every in-flight queue item against the aggregated
  // `listJobs` poll above (one request covers the whole batch, instead of
  // a per-job poll per queued item). Only invalidates the recent-jobs
  // preview when something actually reached a terminal state, so a large
  // batch doesn't force that query to refetch on every tick.
  useEffect(() => {
    const jobs = queueStatusQuery.data;

    if (!jobs) {
      return;
    }

    const jobById = new Map(jobs.map((job) => [job.id, job]));

    const timeoutId = window.setTimeout(() => {
      let hasTerminalTransition = false;

      setQueueItems((previousItems) =>
        previousItems.map((item) => {
          if (!item.jobId || isTerminalStatus(item.status)) {
            return item;
          }

          const job = jobById.get(item.jobId);

          if (!job) {
            return item;
          }

          const update = mapJobToQueueUpdate(job);

          if (update.status && update.status !== item.status && isTerminalStatus(update.status)) {
            hasTerminalTransition = true;
          }

          return { ...item, ...update };
        }),
      );

      if (hasTerminalTransition) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [queueStatusQuery.data, processId, queryClient]);

  useEffect(() => {
    if (inFlightQueueItems.length === 0) {
      if (showQueueManualRefresh) {
        const timeoutId = window.setTimeout(() => {
          setShowQueueManualRefresh(false);
        }, 0);

        return () => window.clearTimeout(timeoutId);
      }
      return;
    }

    if (!earliestInFlightStartedAt) {
      return;
    }

    const elapsedMs = Date.now() - new Date(earliestInFlightStartedAt).getTime();
    const remainingMs = pollingIntervals.timeoutMs - elapsedMs;

    const timeoutId = window.setTimeout(() => {
      setShowQueueManualRefresh(true);
    }, Math.max(remainingMs, 0));

    return () => window.clearTimeout(timeoutId);
  }, [inFlightQueueItems.length, earliestInFlightStartedAt, showQueueManualRefresh]);

  // Concurrency-limited upload scheduler: promotes up to
  // UPLOAD_CONCURRENCY "pending" items to "uploading" at a time. Marking
  // the chosen items as "uploading" synchronously (before the async
  // triggerJob call resolves) ensures the next run of this effect
  // (triggered by that same state update) doesn't re-select them.
  useEffect(() => {
    const uploadingCount = queueItems.filter((item) => item.status === "uploading").length;
    const availableSlots = UPLOAD_CONCURRENCY - uploadingCount;

    if (availableSlots <= 0) {
      return;
    }

    const toStart = queueItems.filter((item) => item.status === "pending").slice(0, availableSlots);

    if (toStart.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const toStartIds = new Set(toStart.map((item) => item.id));
      setQueueItems((previousItems) =>
        previousItems.map((item) => (toStartIds.has(item.id) ? { ...item, status: "uploading" } : item)),
      );

      for (const item of toStart) {
        if (!item.file) {
          continue;
        }

        const file = item.file;
        void api
          .triggerJob(processId, file, file.name)
          .then(({ jobId }) => {
            setQueueItems((previousItems) =>
              previousItems.map((queueItem) =>
                queueItem.id === item.id
                  ? { ...queueItem, status: "queued", jobId, startedAt: new Date().toISOString(), error: null }
                  : queueItem,
              ),
            );
          })
          .catch((error: unknown) => {
            setQueueItems((previousItems) =>
              previousItems.map((queueItem) =>
                queueItem.id === item.id
                  ? { ...queueItem, status: "failed", error: getErrorMessage(error) }
                  : queueItem,
              ),
            );
          });
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [queueItems, processId]);

  const deleteMutation = useMutation({
    mutationFn: api.deleteProcess,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.processes.all });
      router.push("/");
    },
    onError: (error) => {
      showErrorToast(error, "Unable to delete process");
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ job }: { job: Job }) => api.retryJob(processId, job.id),
    onSuccess: async ({ jobId }, { job }) => {
      setQueueItems((previousItems) => [
        ...previousItems,
        {
          id: createQueueItemId(),
          file: null,
          fileName: job.fileName,
          sizeBytes: 0,
          status: "queued",
          jobId,
          error: null,
          detectedFormName: null,
          needsReview: false,
          startedAt: new Date().toISOString(),
        },
      ]);
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
    },
    onError: (error) => {
      showErrorToast(error, "Unable to retry job");
    },
  });

  const process = processQuery.data;
  const uploadDisabledReason = process ? getProcessPollingMessage(process) : null;
  const uploadBlocked = !process || process.routingAnalyzerStatus !== "ready";

  const viewAllJobsHref = useMemo(() => {
    const basePath = `/processes/${processId}/jobs`;
    return needsReviewOnly ? `${basePath}?hasViolations=true` : basePath;
  }, [needsReviewOnly, processId]);

  if (processQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading process detail"
        description="Fetching the saved process configuration and recent job activity."
      />
    );
  }

  if (processQuery.isError || !process) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <ErrorCard
          title="Could not load process"
          message="The business process could not be loaded. Please try again."
          onRetry={() => void processQuery.refetch()}
        />
      </div>
    );
  }

  const allowAnalyzerNames = process.allowedAnalyzers.length > 0 ? process.allowedAnalyzers : [];

  function submitFiles(files: FileList | File[] | null) {
    const { accepted, rejected, overflowCount } = partitionSelection(files, {
      maxFiles: MAX_FILES_PER_SELECTION,
    });

    if (accepted.length === 0 && rejected.length === 0) {
      return;
    }

    const acceptedItems = accepted.map((file) => createPendingQueueItem(file));
    const rejectedItems: UploadQueueItem[] = rejected.map(({ file, reason }) => ({
      ...createPendingQueueItem(file),
      status: "rejected",
      error: reason,
    }));

    setQueueItems((previousItems) => [...previousItems, ...acceptedItems, ...rejectedItems]);

    if (overflowCount > 0) {
      setSelectionNotice(
        `Only the first ${MAX_FILES_PER_SELECTION} files were queued; ${overflowCount} additional ` +
          `file${overflowCount === 1 ? " was" : "s were"} not added.`,
      );
    } else {
      setSelectionNotice(null);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();

    if (uploadBlocked) {
      return;
    }

    submitFiles(event.dataTransfer.files);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    submitFiles(event.target.files);
    event.target.value = "";
  }

  function onQueueItemRetry(item: UploadQueueItem) {
    if (!item.file) {
      return;
    }

    setQueueItems((previousItems) =>
      previousItems.map((queueItem) =>
        queueItem.id === item.id
          ? { ...queueItem, status: "pending", error: null, jobId: null, startedAt: null }
          : queueItem,
      ),
    );
  }

  function onQueueItemReview(item: UploadQueueItem) {
    if (!item.jobId) {
      return;
    }

    router.push(`/processes/${processId}/jobs/${item.jobId}`);
  }

  function onClearCompletedQueueItems() {
    setQueueItems((previousItems) => previousItems.filter((item) => !isTerminalStatus(item.status)));
  }

  function onClearAllQueueItems() {
    setQueueItems([]);
    setSelectionNotice(null);
  }

  function onJobRowActivate(job: Job) {
    if (job.status === "failed") {
      return;
    }

    router.push(`/processes/${processId}/jobs/${job.id}`);
  }

  function onJobRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, job: Job) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onJobRowActivate(job);
    }
  }

  return (
    <>
      <div className="space-y-6">
        <Card className="rounded-lg">
          <CardHeader className="gap-4 border-b">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-label-caps text-muted-foreground">Process detail</p>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-heading text-headline-lg text-foreground">{process.name}</h1>
                  <StatusBadge
                    status={formatStatusLabel(process.routingAnalyzerStatus)}
                    tone={processStatusStyles[process.routingAnalyzerStatus]}
                    icon={processStatusIcons[process.routingAnalyzerStatus]}
                  />
                </div>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{process.description}</p>
                {process.routingAnalyzerError ? (
                  <p className="max-w-3xl text-sm leading-6 text-destructive">{process.routingAnalyzerError}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {canWriteProcesses ? (
                  <Button asChild variant="outline">
                    <Link href={`/processes/${process.id}/edit`}>
                      <Icon name="edit" size={16} />
                      Edit
                    </Link>
                  </Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link href={viewAllJobsHref}>
                    <Icon name="receipt_long" size={16} />
                    View all jobs
                  </Link>
                </Button>
                {canWriteProcesses ? (
                  <Button type="button" variant="destructive" onClick={() => setProcessToDelete(process)}>
                    <Icon name="delete" size={16} />
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-label-caps text-muted-foreground">Process ID</p>
                <p className="mt-3 break-all text-sm font-medium text-foreground">{process.id}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-label-caps text-muted-foreground">Confidence threshold</p>
                <p className="font-heading tabular-figures mt-3 text-2xl font-semibold">
                  {confidenceThresholdFloatToPercent(process.confidenceThreshold)}%
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-label-caps text-muted-foreground">Business owner</p>
                <p className="mt-3 break-words text-sm font-medium text-foreground">{process.ownerEmail}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-label-caps text-muted-foreground">Allowed analyzers</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {allowAnalyzerNames.map((analyzer) => (
                    <Badge key={analyzer.id} variant="neutral">
                      {analyzer.name}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            {showAnalyzerManualRefresh && process.routingAnalyzerStatus === "building" ? (
              <div className="mt-4 rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning">
                Provisioning is taking longer than expected. Refresh manually to check the latest
                routing analyzer status.
                <div className="mt-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => void processQuery.refetch()}>
                    <Icon name="refresh" size={14} />
                    Refresh status
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-label-caps text-muted-foreground">Primary action</p>
                <CardTitle className="text-headline-md">Upload documents</CardTitle>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Drop up to {MAX_FILES_PER_SELECTION} PDF, PNG, JPG, or TIFF documents to queue them for
                  extraction. Files must be 20 MB or smaller; page-count checks still happen on the backend.
                  Documents are processed up to {UPLOAD_CONCURRENCY} at a time.
                </p>
              </div>
              <Badge variant="outline">PDF, TIFF, PNG, JPEG</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              className={cn(
                "group flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                uploadBlocked
                  ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground"
                  : "border-primary/40 bg-card hover:border-primary hover:bg-primary/5",
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
            >
              <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105">
                <Icon name="cloud_upload" size={30} />
              </span>
              <div className="space-y-1">
                <p className="font-heading text-base font-semibold text-foreground">
                  Drag and drop documents here, or <span className="text-primary underline">browse computer</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Automated classification, extraction, and review routing starts immediately.
                </p>
              </div>
              <input
                type="file"
                multiple
                accept={FILE_INPUT_ACCEPT}
                aria-label="Choose documents"
                className="sr-only"
                disabled={uploadBlocked}
                onChange={onFileInputChange}
              />
            </label>

            {uploadDisabledReason ? (
              <div className="rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning">
                {uploadDisabledReason}
              </div>
            ) : null}

            {selectionNotice ? (
              <div className="rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning">
                {selectionNotice}
              </div>
            ) : null}

            {queueStatusQuery.isError && inFlightQueueItems.length > 0 ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {getErrorMessage(queueStatusQuery.error)}
              </div>
            ) : null}

            {showQueueManualRefresh && inFlightQueueItems.length > 0 ? (
              <div className="rounded-lg border border-info-border bg-info-surface p-3 text-sm text-info">
                Processing is taking longer than expected. Refresh manually to check the latest status.
                <div className="mt-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => void queueStatusQuery.refetch()}>
                    <Icon name="refresh" size={14} />
                    Refresh status
                  </Button>
                </div>
              </div>
            ) : null}

            <UploadQueuePanel
              items={queueItems}
              onRetry={onQueueItemRetry}
              onReview={onQueueItemReview}
              onClearCompleted={onClearCompletedQueueItems}
              onClearAll={onClearAllQueueItems}
            />
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <p className="text-label-caps text-muted-foreground">Recent jobs</p>
                <CardTitle className="text-headline-md">Triggered jobs history</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Real-time status of the most recent documents submitted to this process.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={needsReviewOnly}
                  onChange={(event) => setNeedsReviewOnly(event.target.checked)}
                />
                Needs review only
              </label>
            </div>
          </CardHeader>
          <CardContent>
            {recentJobsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading recent jobs…</div>
            ) : null}

            {recentJobsQuery.isError ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Recent job history is unavailable right now.</p>
                <p className="mt-1">{getErrorMessage(recentJobsQuery.error)}</p>
                <div className="mt-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => void recentJobsQuery.refetch()}>
                    Try again
                  </Button>
                </div>
              </div>
            ) : null}

            {!recentJobsQuery.isLoading && !recentJobsQuery.isError ? (
              <div className="overflow-hidden rounded-lg border">
                {recentJobsQuery.data && recentJobsQuery.data.length > 0 ? (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Detected form</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Est. cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentJobsQuery.data.map((job) => {
                        const interactive = job.status !== "failed";
                        const detectedFormLabel = job.unclassified
                          ? "No matching form"
                          : job.detectedFormName || job.detectedForm || "—";

                        return (
                          <TableRow
                            key={job.id}
                            tabIndex={interactive ? 0 : undefined}
                            role={interactive ? "link" : undefined}
                            className={cn(
                              "align-top",
                              interactive ? "cursor-pointer focus:bg-muted/50 focus:outline-none" : "",
                            )}
                            onClick={interactive ? () => onJobRowActivate(job) : undefined}
                            onKeyDown={interactive ? (event) => onJobRowKeyDown(event, job) : undefined}
                          >
                            <TableCell className="min-w-64 whitespace-normal p-3">
                              <div className="space-y-2">
                                <p className="font-medium text-foreground">{job.fileName}</p>
                                <div className="flex flex-wrap gap-2">
                                  {job.confidenceViolations && job.confidenceViolations.length > 0 ? (
                                    <NeedsReviewBadge show />
                                  ) : null}
                                  {job.unclassified ? (
                                    <Badge variant="neutral">No matching form</Badge>
                                  ) : null}
                                </div>
                                {job.status === "failed" && job.error ? (
                                  <p className="text-xs leading-5 text-destructive">{job.error}</p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{formatDateTime(job.submittedAt)}</TableCell>
                            <TableCell>
                              <JobStatusBadge status={job.status} />
                              {job.status === "failed" ? (
                                <div className="mt-3">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={retryMutation.isPending}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      retryMutation.mutate({ job });
                                    }}
                                  >
                                    {retryMutation.isPending ? "Retrying…" : "Retry"}
                                  </Button>
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{detectedFormLabel}</TableCell>
                            <TableCell>
                              <AverageConfidenceValue averageConfidence={job.averageConfidence} />
                            </TableCell>
                            <TableCell>
                              <EstimatedCostValue estimatedCostUsd={job.estimatedCostUsd} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    No jobs match the current filter yet.
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <DeleteProcessDialog
        process={processToDelete}
        open={processToDelete !== null}
        deleting={deleteMutation.isPending}
        onCancel={() => setProcessToDelete(null)}
        onConfirm={() => {
          if (processToDelete) {
            deleteMutation.mutate(processToDelete.id);
          }
        }}
      />
    </>
  );
}
