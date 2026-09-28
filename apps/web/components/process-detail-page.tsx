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
import { api, type BusinessProcess, type Job } from "@/lib/api";
import { getErrorMessage, showErrorToast } from "@/lib/errors";
import { confidenceThresholdFloatToPercent } from "@/lib/process-threshold";
import { getPollingInterval, pollingIntervals } from "@/lib/query";
import { queryKeys } from "@/lib/query-keys";
import { hasCapability } from "@/lib/roles";
import { cn } from "@/lib/utils";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const RECENT_JOBS_LIMIT = 5;
const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"];
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/x-tiff",
] as const;
const FILE_INPUT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff";

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

function validateUpload(files: FileList | File[] | null) {
  if (!files || files.length === 0) {
    return "Select a file to upload.";
  }

  if (files.length > 1) {
    return "Upload exactly one PDF, PNG, JPG, or TIFF document at a time.";
  }

  const [file] = Array.from(files);
  const normalizedName = file.name.toLowerCase();
  const hasValidExtension = ACCEPTED_EXTENSIONS.some((extension) => normalizedName.endsWith(extension));
  const hasValidMimeType =
    file.type.length === 0 ||
    ACCEPTED_MIME_TYPES.includes(file.type.toLowerCase() as (typeof ACCEPTED_MIME_TYPES)[number]);

  if (!hasValidExtension || !hasValidMimeType) {
    return "Only PDF, PNG, JPG, or TIFF files are supported.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return "Files must be 20 MB or smaller.";
  }

  return undefined;
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
  const [processToDelete, setProcessToDelete] = useState<BusinessProcess | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobPollingStartedAt, setJobPollingStartedAt] = useState<string | null>(null);
  const [showJobManualRefresh, setShowJobManualRefresh] = useState(false);
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

  const activeJobQuery = useQuery({
    queryKey: activeJobId ? queryKeys.jobs.detail(processId, activeJobId) : ["processes", processId, "jobs", "active"],
    queryFn: async () => {
      if (!activeJobId) {
        throw new Error("Active job ID is required.");
      }

      return api.getJob(processId, activeJobId);
    },
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      if (!activeJobId || query.state.error) {
        return false;
      }

      const job = query.state.data as Job | undefined;

      if (job && (job.status === "succeeded" || job.status === "failed")) {
        return false;
      }

      return getPollingInterval({
        startedAt: jobPollingStartedAt,
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

  useEffect(() => {
    if (activeJobId !== null && jobPollingStartedAt === null) {
      const timeoutId = window.setTimeout(() => {
        setJobPollingStartedAt(new Date().toISOString());
        setShowJobManualRefresh(false);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    if (activeJobId === null && jobPollingStartedAt !== null) {
      const timeoutId = window.setTimeout(() => {
        setJobPollingStartedAt(null);
        setShowJobManualRefresh(false);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [activeJobId, jobPollingStartedAt]);

  useEffect(() => {
    if (!activeJobId || !jobPollingStartedAt) {
      return;
    }

    const elapsedMs = Date.now() - new Date(jobPollingStartedAt).getTime();
    const remainingMs = pollingIntervals.timeoutMs - elapsedMs;

    const timeoutId = window.setTimeout(() => {
      setShowJobManualRefresh(true);
    }, Math.max(remainingMs, 0));

    return () => window.clearTimeout(timeoutId);
  }, [activeJobId, jobPollingStartedAt]);

  useEffect(() => {
    const job = activeJobQuery.data;

    if (!job || !activeJobId) {
      return;
    }

    let timeoutId: number | undefined;

    if (job.status === "succeeded") {
      timeoutId = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });

        if (job.unclassified) {
          setUploadNotice(`“${job.fileName}” didn't match any configured form for this business process.`);
          setActiveJobId(null);
          return;
        }

        router.push(`/processes/${processId}/jobs/${job.id}`);
      }, 0);
    }

    if (job.status === "failed") {
      timeoutId = window.setTimeout(() => {
        setUploadError(job.error ?? `Processing failed for “${job.fileName}”.`);
        void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
        setActiveJobId(null);
      }, 0);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeJobId, activeJobQuery.data, processId, queryClient, router]);

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

  const triggerMutation = useMutation({
    mutationFn: ({ file }: { file: File }) => api.triggerJob(processId, file, file.name),
    onSuccess: async ({ jobId }) => {
      setJobPollingStartedAt(new Date().toISOString());
      setShowJobManualRefresh(false);
      setUploadError(null);
      setUploadNotice(`Processing started. Polling status for the uploaded document.`);
      setActiveJobId(jobId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
    },
    onError: (error) => {
      setUploadNotice(null);
      showErrorToast(error, "Unable to upload document");
    },
  });

  const retryMutation = useMutation({
    mutationFn: ({ jobId }: { jobId: string }) => api.retryJob(processId, jobId),
    onSuccess: async ({ jobId }) => {
      setJobPollingStartedAt(new Date().toISOString());
      setShowJobManualRefresh(false);
      setUploadError(null);
      setUploadNotice("Retry accepted. Polling the new job now.");
      setActiveJobId(jobId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
    },
    onError: (error) => {
      showErrorToast(error, "Unable to retry job");
    },
  });

  const process = processQuery.data;
  const uploadDisabledReason = process ? getProcessPollingMessage(process) : null;
  const uploadBlocked = !process || process.routingAnalyzerStatus !== "ready";
  const activeJob = activeJobQuery.data;
  const isPollingJob =
    activeJobId !== null &&
    (!activeJob || activeJob.status === "queued" || activeJob.status === "running");

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
    setUploadNotice(null);
    setUploadError(null);

    const validationError = validateUpload(files);

    if (validationError) {
      setUploadError(validationError);
      return;
    }

    const [file] = Array.from(files as FileList | File[]);
    triggerMutation.mutate({ file });
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();

    if (uploadBlocked || triggerMutation.isPending || isPollingJob) {
      return;
    }

    submitFiles(event.dataTransfer.files);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    submitFiles(event.target.files);
    event.target.value = "";
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
                  Drop a PDF, PNG, JPG, or TIFF document to trigger extraction for this process.
                  Files must be 20 MB or smaller; page-count checks still happen on the backend.
                </p>
              </div>
              <Badge variant="outline">PDF, TIFF, PNG, JPEG</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              className={cn(
                "group flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                uploadBlocked || triggerMutation.isPending || isPollingJob
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
                  Drag and drop a document here, or <span className="text-primary underline">browse computer</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Automated classification, extraction, and review routing starts immediately.
                </p>
              </div>
              <input
                type="file"
                accept={FILE_INPUT_ACCEPT}
                aria-label="Choose document"
                className="sr-only"
                disabled={uploadBlocked || triggerMutation.isPending || isPollingJob}
                onChange={onFileInputChange}
              />
            </label>

            {uploadDisabledReason ? (
              <div className="rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning">
                {uploadDisabledReason}
              </div>
            ) : null}

            {triggerMutation.isPending || isPollingJob ? (
              <div className="rounded-lg border border-info-border bg-info-surface p-3 text-sm text-info">
                <div className="flex items-center gap-2 font-medium">
                  <Icon name="progress_activity" size={16} className="animate-spin" />
                  {triggerMutation.isPending ? "Uploading document…" : "Processing document…"}
                </div>
                <p className="mt-2 text-sm">
                  {activeJob?.status === "running"
                    ? "Extraction is running now."
                    : "Waiting for the job to complete."}
                </p>
                {showJobManualRefresh && activeJobId ? (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void activeJobQuery.refetch()}
                    >
                      <Icon name="refresh" size={14} />
                      Refresh job status
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeJobQuery.isError && activeJobId ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {getErrorMessage(activeJobQuery.error)}
              </div>
            ) : null}

            {uploadError ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {uploadError}
              </div>
            ) : null}

            {uploadNotice ? (
              <div className="rounded-lg border border-success-border bg-success-surface p-3 text-sm text-success">
                {uploadNotice}
              </div>
            ) : null}
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
                                      retryMutation.mutate({ jobId: job.id });
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
