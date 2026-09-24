"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Pencil, RefreshCcw, Trash2, Upload } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { api, type BusinessProcess, type Job } from "@/lib/api";
import { getErrorMessage, showErrorToast } from "@/lib/errors";
import { confidenceThresholdFloatToPercent } from "@/lib/process-threshold";
import { getPollingInterval, pollingIntervals } from "@/lib/query";
import { queryKeys } from "@/lib/query-keys";
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
  building: "border-amber-200 bg-amber-50 text-amber-700",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-process-title"
        className="w-full max-w-md rounded-3xl border bg-background p-6 shadow-xl"
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

function StatusBadge({ status, tone }: { status: string; tone: string }) {
  return <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>{status}</span>;
}

export function ProcessDetailPage({ processId }: { processId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

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
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-3xl border bg-background p-8 shadow-sm">
          <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Process detail
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">{process.name}</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{process.description}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href={`/processes/${process.id}/edit`}>
                  <Pencil className="size-4" />
                  Edit
                </Link>
              </Button>
              <Button type="button" variant="destructive" onClick={() => setProcessToDelete(process)}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border bg-muted/20 p-5">
              <p className="text-sm font-medium text-foreground">Allowed analyzers</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {allowAnalyzerNames.map((analyzer) => (
                  <span key={analyzer.id} className="rounded-full border bg-background px-2.5 py-1 text-xs">
                    {analyzer.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-5">
              <p className="text-sm font-medium text-foreground">Routing analyzer status</p>
              <div className="mt-3 space-y-3">
                <StatusBadge
                  status={formatStatusLabel(process.routingAnalyzerStatus)}
                  tone={processStatusStyles[process.routingAnalyzerStatus]}
                />
                {process.routingAnalyzerError ? (
                  <p className="text-sm leading-6 text-destructive">{process.routingAnalyzerError}</p>
                ) : null}
                {showAnalyzerManualRefresh && process.routingAnalyzerStatus === "building" ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Provisioning is taking longer than expected. Refresh manually to check the latest
                    routing analyzer status.
                    <div className="mt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => void processQuery.refetch()}>
                        <RefreshCcw className="size-3.5" />
                        Refresh status
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-5">
              <p className="text-sm font-medium text-foreground">Average Confidence threshold</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">
                {confidenceThresholdFloatToPercent(process.confidenceThreshold)}%
              </p>
            </div>

            <div className="rounded-2xl border bg-muted/20 p-5">
              <p className="text-sm font-medium text-foreground">Business owner</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{process.ownerEmail}</p>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border bg-background p-6 shadow-sm">
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Upload document
              </p>
              <h2 className="text-xl font-semibold tracking-tight">Inference testing</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Upload a PDF, PNG, JPG, or TIFF up to 20 MB. Page-count checks still happen on the
                backend.
              </p>
            </div>

            <div className="mt-5 space-y-4">
              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border border-dashed p-6 text-center transition-colors",
                  uploadBlocked || triggerMutation.isPending || isPollingJob
                    ? "cursor-not-allowed border-muted-foreground/20 bg-muted/20 text-muted-foreground"
                    : "border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10",
                )}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                <Upload className="size-8" />
                <div className="space-y-1">
                  <p className="font-medium">Drag and drop a document here</p>
                  <p className="text-sm text-muted-foreground">
                    or click to choose a file from your device
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
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {uploadDisabledReason}
                </div>
              ) : null}

              {triggerMutation.isPending || isPollingJob ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  <div className="flex items-center gap-2 font-medium">
                    <LoaderCircle className="size-4 animate-spin" />
                    {triggerMutation.isPending ? "Uploading document…" : "Processing document…"}
                  </div>
                  <p className="mt-2 text-sm text-blue-900/80">
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
                        <RefreshCcw className="size-3.5" />
                        Refresh job status
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeJobQuery.isError && activeJobId ? (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                  {getErrorMessage(activeJobQuery.error)}
                </div>
              ) : null}

              {uploadError ? (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                  {uploadError}
                </div>
              ) : null}

              {uploadNotice ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  {uploadNotice}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border bg-background p-6 shadow-sm">
            <div className="flex flex-col gap-4 border-b pb-4">
              <div className="space-y-2">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Recent jobs
                </p>
                <h2 className="text-xl font-semibold tracking-tight">History preview</h2>
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

            {recentJobsQuery.isLoading ? (
              <div className="mt-4 text-sm text-muted-foreground">Loading recent jobs…</div>
            ) : null}

            {recentJobsQuery.isError ? (
              <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
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
              <div className="mt-4 overflow-hidden rounded-2xl border">
                {recentJobsQuery.data && recentJobsQuery.data.length > 0 ? (
                  <table className="min-w-full divide-y divide-border text-left text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">File</th>
                        <th className="px-3 py-2 font-medium">Submitted</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Detected form</th>
                        <th className="px-3 py-2 font-medium">Confidence</th>
                        <th className="px-3 py-2 font-medium">Est. cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-background">
                      {recentJobsQuery.data.map((job) => {
                        const interactive = job.status !== "failed";
                        const detectedFormLabel = job.unclassified
                          ? "No matching form"
                          : job.detectedFormName || job.detectedForm || "—";

                        return (
                          <tr
                            key={job.id}
                            tabIndex={interactive ? 0 : undefined}
                            role={interactive ? "link" : undefined}
                            className={cn(
                              "align-top",
                              interactive ? "cursor-pointer hover:bg-muted/20 focus:bg-muted/20 focus:outline-none" : "",
                            )}
                            onClick={interactive ? () => onJobRowActivate(job) : undefined}
                            onKeyDown={interactive ? (event) => onJobRowKeyDown(event, job) : undefined}
                          >
                            <td className="px-3 py-3">
                              <div className="space-y-2">
                                <p className="font-medium text-foreground">{job.fileName}</p>
                                <div className="flex flex-wrap gap-2">
                                  {job.confidenceViolations && job.confidenceViolations.length > 0 ? (
                                    <NeedsReviewBadge show />
                                  ) : null}
                                  {job.unclassified ? (
                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                                      No matching form
                                    </span>
                                  ) : null}
                                </div>
                                {job.status === "failed" && job.error ? (
                                  <p className="text-xs leading-5 text-destructive">{job.error}</p>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{formatDateTime(job.submittedAt)}</td>
                            <td className="px-3 py-3">
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
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{detectedFormLabel}</td>
                            <td className="px-3 py-3">
                              <AverageConfidenceValue averageConfidence={job.averageConfidence} />
                            </td>
                            <td className="px-3 py-3">
                              <EstimatedCostValue estimatedCostUsd={job.estimatedCostUsd} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    No jobs match the current filter yet.
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-4">
              <Button asChild variant="outline">
                <Link href={viewAllJobsHref}>View all jobs</Link>
              </Button>
            </div>
          </section>
        </aside>
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
