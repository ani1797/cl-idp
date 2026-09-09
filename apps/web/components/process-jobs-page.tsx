"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, RefreshCcw } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AverageConfidenceValue,
  EstimatedCostValue,
  formatCostUsd,
  formatDateTime,
  JobStatusBadge,
  NeedsReviewBadge,
  ProcessingIndicator,
  ReviewedIndicator,
} from "@/components/job-history-ui";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Button } from "@/components/ui/button";
import {
  api,
  type AnalyzerRef,
  type BusinessProcess,
  type Job,
  type JobListFilters,
  type JobStatus,
} from "@/lib/api";
import { getErrorMessage, showErrorToast } from "@/lib/errors";
import { getPollingInterval, pollingIntervals } from "@/lib/query";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const JOBS_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 300;
const IN_FLIGHT_STATUSES = new Set<JobStatus>(["queued", "running"]);
const STATUS_OPTIONS: JobStatus[] = ["queued", "running", "succeeded", "failed"];

type ReviewedFilter = "any" | "reviewed" | "not-reviewed";

type ProcessJobsFilterState = {
  status: JobStatus[];
  detectedForm: string[];
  hasViolations: boolean;
  reviewed: ReviewedFilter;
  unclassified: boolean;
  fileName: string;
  submittedFromDate: string;
  submittedToDate: string;
};

type SearchParamsReader = Pick<URLSearchParams, "get" | "getAll">;

type SummaryCardProps = {
  label: string;
  value: number | string;
};

type FailedJobErrorProps = {
  error: string;
};

function FileNameFilterInput({
  initialValue,
  onCommit,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (value === initialValue) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onCommit(value);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [initialValue, onCommit, value]);

  return (
    <input
      id="file-name-filter"
      type="search"
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
      placeholder="Search by file name"
      className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
    />
  );
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function FailedJobError({ error }: FailedJobErrorProps) {
  return (
    <details className="max-w-xl rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
      <summary className="cursor-pointer list-none font-medium">
        <span className="block truncate">Error: {error}</span>
      </summary>
      <p className="mt-2 whitespace-pre-wrap break-words leading-5">{error}</p>
    </details>
  );
}

function formatDetectedForm(job: Job) {
  if (job.unclassified) {
    return "No matching form";
  }

  return job.detectedFormName || job.detectedForm || "—";
}

function hasInFlightJobs(jobs: Job[] | undefined) {
  return (jobs ?? []).some((job) => IN_FLIGHT_STATUSES.has(job.status));
}

function parseDateParamToInput(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function dateInputToBoundaryIso(value: string, kind: "from" | "to") {
  if (!value) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (![year, month, day].every(Number.isFinite)) {
    return undefined;
  }

  if (kind === "from") {
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)).toISOString();
  }

  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)).toISOString();
}

function uniq<T>(values: T[]) {
  return Array.from(new Set(values));
}

function parseSearchParams(searchParams: SearchParamsReader): ProcessJobsFilterState {
  const reviewedParam = searchParams.get("reviewed");

  return {
    status: searchParams
      .getAll("status")
      .filter((value): value is JobStatus => STATUS_OPTIONS.includes(value as JobStatus)),
    detectedForm: uniq(searchParams.getAll("detectedForm").filter(Boolean)),
    hasViolations: searchParams.get("hasViolations") === "true",
    reviewed:
      reviewedParam === "true"
        ? "reviewed"
        : reviewedParam === "false"
          ? "not-reviewed"
          : "any",
    unclassified: searchParams.get("unclassified") === "true",
    fileName: searchParams.get("fileName") ?? "",
    submittedFromDate: parseDateParamToInput(searchParams.get("submittedFrom")),
    submittedToDate: parseDateParamToInput(searchParams.get("submittedTo")),
  };
}

function buildSearchParams(state: ProcessJobsFilterState) {
  const params = new URLSearchParams();

  state.status.forEach((status) => params.append("status", status));
  state.detectedForm.forEach((detectedForm) => params.append("detectedForm", detectedForm));

  if (state.hasViolations) {
    params.set("hasViolations", "true");
  }

  if (state.reviewed === "reviewed") {
    params.set("reviewed", "true");
  }

  if (state.reviewed === "not-reviewed") {
    params.set("reviewed", "false");
  }

  if (state.unclassified) {
    params.set("unclassified", "true");
  }

  const trimmedFileName = state.fileName.trim();

  if (trimmedFileName) {
    params.set("fileName", trimmedFileName);
  }

  const submittedFrom = dateInputToBoundaryIso(state.submittedFromDate, "from");
  const submittedTo = dateInputToBoundaryIso(state.submittedToDate, "to");

  if (submittedFrom) {
    params.set("submittedFrom", submittedFrom);
  }

  if (submittedTo) {
    params.set("submittedTo", submittedTo);
  }

  return params;
}

function buildListFilters(state: ProcessJobsFilterState): JobListFilters {
  const searchParams = buildSearchParams(state);

  return {
    status: state.status.length > 0 ? state.status : undefined,
    detectedForm: state.detectedForm.length > 0 ? state.detectedForm : undefined,
    hasViolations: searchParams.get("hasViolations") === "true" ? true : undefined,
    reviewed:
      state.reviewed === "reviewed"
        ? true
        : state.reviewed === "not-reviewed"
          ? false
          : undefined,
    unclassified: searchParams.get("unclassified") === "true" ? true : undefined,
    fileName: searchParams.get("fileName") ?? undefined,
    submittedFrom: searchParams.get("submittedFrom") ?? undefined,
    submittedTo: searchParams.get("submittedTo") ?? undefined,
  };
}

function getFilterUrl(pathname: string, state: ProcessJobsFilterState) {
  const nextSearch = buildSearchParams(state).toString();
  return nextSearch ? `${pathname}?${nextSearch}` : pathname;
}

function toggleMultiSelectValue(current: string[], value: string, checked: boolean) {
  const next = checked ? [...current, value] : current.filter((item) => item !== value);
  return uniq(next);
}

function getDetectedFormOptions(process: BusinessProcess | undefined, jobs: Job[] | undefined, selected: string[]) {
  const labelById = new Map<string, string>();

  (process?.allowedAnalyzers ?? []).forEach((analyzer: AnalyzerRef) => {
    labelById.set(analyzer.id, analyzer.name);
  });

  (jobs ?? []).forEach((job) => {
    if (job.detectedForm) {
      labelById.set(job.detectedForm, job.detectedFormName || job.detectedForm);
    }
  });

  selected.forEach((value) => {
    if (!labelById.has(value)) {
      labelById.set(value, value);
    }
  });

  return Array.from(labelById.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function ProcessJobsPage({ processId }: { processId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const filterState = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const [listPollingStartedAt, setListPollingStartedAt] = useState<string | null>(null);

  const filterUrl = useMemo(() => getFilterUrl(pathname, filterState), [filterState, pathname]);
  const hasActiveFilters = filterUrl !== pathname;

  const sharedFilters = useMemo(() => buildListFilters(filterState), [filterState]);
  const jobsFilters = useMemo(() => ({ ...sharedFilters, limit: JOBS_LIMIT }), [sharedFilters]);
  const filterKey = useMemo(() => buildSearchParams(filterState).toString(), [filterState]);

  const processQuery = useQuery({
    queryKey: queryKeys.processes.detail(processId),
    queryFn: () => api.getProcess(processId),
  });

  const jobsQuery = useQuery({
    queryKey: [...queryKeys.jobs.all(processId), "list", filterKey, JOBS_LIMIT],
    queryFn: () => api.listJobs(processId, jobsFilters),
    enabled: processQuery.isSuccess,
    refetchInterval: (query) => {
      const jobs = query.state.data as Job[] | undefined;

      if (!hasInFlightJobs(jobs)) {
        return false;
      }

      return getPollingInterval({
        startedAt: listPollingStartedAt,
        fastMs: pollingIntervals.jobs.fastMs,
        slowMs: pollingIntervals.jobs.slowMs,
      });
    },
  });

  const summaryQuery = useQuery({
    queryKey: [...queryKeys.jobs.all(processId), "summary", filterKey],
    queryFn: () => api.getJobsSummary(processId, sharedFilters),
    enabled: processQuery.isSuccess,
  });

  const unfilteredSummaryQuery = useQuery({
    queryKey: [...queryKeys.jobs.all(processId), "summary", "unfiltered"],
    queryFn: () => api.getJobsSummary(processId),
    enabled: processQuery.isSuccess,
  });

  useEffect(() => {
    const polling = hasInFlightJobs(jobsQuery.data);

    if (polling && listPollingStartedAt === null) {
      const timeoutId = window.setTimeout(() => {
        setListPollingStartedAt(new Date().toISOString());
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    if (!polling && listPollingStartedAt !== null) {
      const timeoutId = window.setTimeout(() => {
        setListPollingStartedAt(null);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [jobsQuery.data, listPollingStartedAt]);

  const retryMutation = useMutation({
    mutationFn: ({ jobId }: { jobId: string }) => api.retryJob(processId, jobId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
    },
    onError: (error) => {
      showErrorToast(error, "Unable to retry job");
    },
  });

  function updateFilters(nextState: ProcessJobsFilterState) {
    router.replace(getFilterUrl(pathname, nextState), { scroll: false });
  }

  function updateStatusFilter(status: JobStatus, checked: boolean) {
    updateFilters({
      ...filterState,
      status: toggleMultiSelectValue(filterState.status, status, checked) as JobStatus[],
    });
  }

  function updateDetectedFormFilter(detectedForm: string, checked: boolean) {
    updateFilters({
      ...filterState,
      detectedForm: toggleMultiSelectValue(filterState.detectedForm, detectedForm, checked),
    });
  }

  function onJobActivate(job: Job) {
    if (job.status !== "succeeded") {
      return;
    }

    const from = encodeURIComponent(filterUrl);
    router.push(`/processes/${processId}/jobs/${job.id}?from=${from}`);
  }

  function onJobKeyDown(event: KeyboardEvent<HTMLTableRowElement>, job: Job) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onJobActivate(job);
    }
  }

  if (processQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading process jobs"
        description="Fetching the process details, job summary, and recent history."
      />
    );
  }

  if (processQuery.isError || !processQuery.data) {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <ErrorCard
          title="Could not load process jobs"
          message="The business process or its job history could not be loaded. Please try again."
          onRetry={() => {
            void processQuery.refetch();
            void jobsQuery.refetch();
            void summaryQuery.refetch();
            void unfilteredSummaryQuery.refetch();
          }}
        />
      </div>
    );
  }

  const process = processQuery.data;

  if (jobsQuery.isLoading || summaryQuery.isLoading || unfilteredSummaryQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading process jobs"
        description="Fetching the process details, job summary, and recent history."
      />
    );
  }

  if (jobsQuery.isError || summaryQuery.isError || unfilteredSummaryQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <ErrorCard
          title="Could not load job history"
          message={
            jobsQuery.isError
              ? getErrorMessage(jobsQuery.error)
              : summaryQuery.isError
                ? getErrorMessage(summaryQuery.error)
                : getErrorMessage(unfilteredSummaryQuery.error)
          }
          onRetry={() => {
            void jobsQuery.refetch();
            void summaryQuery.refetch();
            void unfilteredSummaryQuery.refetch();
          }}
        />
      </div>
    );
  }

  const jobs = jobsQuery.data ?? [];
  const summary = summaryQuery.data ?? {
    total: 0,
    needsReview: 0,
    failed: 0,
    unclassified: 0,
    totalEstimatedCostUsd: 0,
  };
  const unfilteredTotal = unfilteredSummaryQuery.data?.total ?? 0;
  const detectedFormOptions = getDetectedFormOptions(process, jobs, filterState.detectedForm);
  const showingCappedResults = summary.total > JOBS_LIMIT;
  const noJobsYet = unfilteredTotal === 0;
  const noMatches = !noJobsYet && summary.total === 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="rounded-3xl border bg-background p-8 shadow-sm">
        <div className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <Link
              href={`/processes/${processId}`}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to process detail
            </Link>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Process jobs
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">{process.name}</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Filter, review, and retry document inference jobs for this business process.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void jobsQuery.refetch()}>
              <RefreshCcw className="size-4" />
              Refresh jobs
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Total jobs" value={summary.total} />
          <SummaryCard label="Needs review" value={summary.needsReview} />
          <SummaryCard label="Failed" value={summary.failed} />
          <SummaryCard label="Unclassified" value={summary.unclassified} />
          <SummaryCard label="Estimated cost" value={formatCostUsd(summary.totalEstimatedCostUsd) ?? "$0.00"} />
        </div>
      </section>

      <section className="rounded-3xl border bg-background p-8 shadow-sm">
        <div className="flex flex-col gap-4 border-b pb-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">Filters</h2>
              <p className="text-sm text-muted-foreground">
                All filters sync to the URL so this backlog view can be refreshed or shared.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                updateFilters({
                  status: [],
                  detectedForm: [],
                  hasViolations: false,
                  reviewed: "any",
                  unclassified: false,
                  fileName: "",
                  submittedFromDate: "",
                  submittedToDate: "",
                })
              }
              disabled={!hasActiveFilters}
            >
              Clear filters
            </Button>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Status</legend>
              <div className="space-y-2">
                {STATUS_OPTIONS.map((status) => (
                  <label key={status} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={filterState.status.includes(status)}
                      onChange={(event) => updateStatusFilter(status, event.target.checked)}
                    />
                    {status}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Detected form</legend>
              <div className="max-h-44 space-y-2 overflow-auto rounded-2xl border p-3">
                {detectedFormOptions.length > 0 ? (
                  detectedFormOptions.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={filterState.detectedForm.includes(option.value)}
                        onChange={(event) => updateDetectedFormFilter(option.value, event.target.checked)}
                      />
                      {option.label}
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No detected forms available yet.</p>
                )}
              </div>
            </fieldset>

            <div className="space-y-3">
              <label htmlFor="file-name-filter" className="text-sm font-medium">
                File name
              </label>
              <FileNameFilterInput
                key={filterState.fileName}
                initialValue={filterState.fileName}
                onCommit={(value) =>
                  updateFilters({
                    ...filterState,
                    fileName: value,
                  })
                }
              />
            </div>

            <div className="space-y-3">
              <label htmlFor="reviewed-filter" className="text-sm font-medium">
                Reviewed
              </label>
              <select
                id="reviewed-filter"
                value={filterState.reviewed}
                onChange={(event) =>
                  updateFilters({
                    ...filterState,
                    reviewed: event.target.value as ReviewedFilter,
                  })
                }
                className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
              >
                <option value="any">Any</option>
                <option value="reviewed">Reviewed</option>
                <option value="not-reviewed">Not reviewed</option>
              </select>
            </div>

            <label className="flex items-center gap-2 rounded-2xl border p-4 text-sm">
              <input
                type="checkbox"
                checked={filterState.hasViolations}
                onChange={(event) =>
                  updateFilters({
                    ...filterState,
                    hasViolations: event.target.checked,
                  })
                }
              />
              Needs review only
            </label>

            <label className="flex items-center gap-2 rounded-2xl border p-4 text-sm">
              <input
                type="checkbox"
                checked={filterState.unclassified}
                onChange={(event) =>
                  updateFilters({
                    ...filterState,
                    unclassified: event.target.checked,
                  })
                }
              />
              Unclassified only
            </label>

            <div className="space-y-3">
              <label htmlFor="submitted-from-filter" className="text-sm font-medium">
                Submitted from
              </label>
              <input
                id="submitted-from-filter"
                type="date"
                value={filterState.submittedFromDate}
                onChange={(event) =>
                  updateFilters({
                    ...filterState,
                    submittedFromDate: event.target.value,
                  })
                }
                className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-3">
              <label htmlFor="submitted-to-filter" className="text-sm font-medium">
                Submitted to
              </label>
              <input
                id="submitted-to-filter"
                type="date"
                value={filterState.submittedToDate}
                onChange={(event) =>
                  updateFilters({
                    ...filterState,
                    submittedToDate: event.target.value,
                  })
                }
                className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {showingCappedResults ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Showing first {jobs.length} of {summary.total} matching jobs — narrow your filters.
          </div>
        ) : null}

        {noJobsYet ? (
          <div className="mt-6 rounded-3xl border border-dashed bg-muted/30 p-10 text-center">
            <h3 className="text-xl font-semibold tracking-tight">No jobs yet for this process</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Upload a document from the process detail screen to start building this job history.
            </p>
            <div className="mt-6">
              <Button asChild>
                <Link href={`/processes/${processId}`}>Go to process detail</Link>
              </Button>
            </div>
          </div>
        ) : noMatches ? (
          <div className="mt-6 rounded-3xl border border-dashed bg-muted/30 p-10 text-center">
            <h3 className="text-xl font-semibold tracking-tight">No jobs match these filters</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Try broadening the filters or clear them to return to the full job history.
            </p>
            <div className="mt-6">
              <Button
                type="button"
                onClick={() =>
                  updateFilters({
                    status: [],
                    detectedForm: [],
                    hasViolations: false,
                    reviewed: "any",
                    unclassified: false,
                    fileName: "",
                    submittedFromDate: "",
                    submittedToDate: "",
                  })
                }
              >
                Clear filters
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-3xl border">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-left text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">File name</th>
                    <th className="px-4 py-3 font-medium">Submitted</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Detected form</th>
                    <th className="px-4 py-3 font-medium">Field count</th>
                    <th className="px-4 py-3 font-medium">Confidence</th>
                    <th className="px-4 py-3 font-medium">Est. cost</th>
                    <th className="px-4 py-3 font-medium">Needs review</th>
                    <th className="px-4 py-3 font-medium">Reviewed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {jobs.map((job) => {
                    const interactive = job.status === "succeeded";
                    const needsReview = Boolean(job.confidenceViolations && job.confidenceViolations.length > 0);

                    return (
                      <tr
                        key={job.id}
                        tabIndex={interactive ? 0 : undefined}
                        role={interactive ? "link" : undefined}
                        className={cn(
                          "align-top",
                          interactive ? "cursor-pointer hover:bg-muted/20 focus:bg-muted/20 focus:outline-none" : "",
                        )}
                        onClick={interactive ? () => onJobActivate(job) : undefined}
                        onKeyDown={interactive ? (event) => onJobKeyDown(event, job) : undefined}
                      >
                        <td className="px-4 py-4">
                          <div className="space-y-2">
                            <p className="font-medium text-foreground">{job.fileName}</p>
                            {job.unclassified ? (
                              <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                                No matching form
                              </span>
                            ) : null}
                            {job.status === "failed" && job.error ? <FailedJobError error={job.error} /> : null}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{formatDateTime(job.submittedAt)}</td>
                        <td className="px-4 py-4">
                          <div className="space-y-3">
                            <JobStatusBadge status={job.status} />
                            {job.status === "queued" || job.status === "running" ? (
                              <ProcessingIndicator status={job.status} />
                            ) : null}
                            {job.status === "failed" ? (
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
                                Retry
                              </Button>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{formatDetectedForm(job)}</td>
                        <td className="px-4 py-4 text-muted-foreground">{job.fieldCount ?? 0}</td>
                        <td className="px-4 py-4">
                          <AverageConfidenceValue averageConfidence={job.averageConfidence} />
                        </td>
                        <td className="px-4 py-4">
                          <EstimatedCostValue estimatedCostUsd={job.estimatedCostUsd} />
                        </td>
                        <td className="px-4 py-4">
                          <NeedsReviewBadge show={needsReview} />
                        </td>
                        <td className="px-4 py-4">
                          <ReviewedIndicator reviewedAt={job.reviewedAt} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {listPollingStartedAt ? (
          <div className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="size-3.5" />
            Live updates are active while queued or running jobs remain in this view.
          </div>
        ) : null}
      </section>
    </div>
  );
}
