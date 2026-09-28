"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { KpiCard, SectionHeader } from "@/components/brand/primitives";
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
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { hasCapability } from "@/lib/roles";
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

type FailedJobErrorProps = {
  error: string;
};

const EMPTY_FILTER_STATE: ProcessJobsFilterState = {
  status: [],
  detectedForm: [],
  hasViolations: false,
  reviewed: "any",
  unclassified: false,
  fileName: "",
  submittedFromDate: "",
  submittedToDate: "",
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
    <div className="relative">
      <Icon
        name="search"
        size={18}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id="file-name-filter"
        type="search"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
        placeholder="Search by file name"
        className="h-9 bg-card pl-9"
      />
    </div>
  );
}

function FailedJobError({ error }: FailedJobErrorProps) {
  return (
    <details className="max-w-xl rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
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

function FilterChip({
  checked,
  children,
}: {
  checked: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground",
      )}
    >
      {checked ? <Icon name="check" size={14} /> : null}
      {children}
    </span>
  );
}

function FilterGroup({
  legend,
  children,
  className,
}: {
  legend: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-2", className)}>
      <legend className="text-label-caps text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function clearableFilterState() {
  return { ...EMPTY_FILTER_STATE };
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
  const { user } = useSession();
  const canRetryJobs = hasCapability(user?.roleLabel, "review:act");

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
    <div className="flex w-full flex-col gap-6">
      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <Link
              href={`/processes/${processId}`}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              <Icon name="arrow_back" size={16} />
              Back to process detail
            </Link>
            <p className="text-label-caps text-muted-foreground">
              Process jobs
            </p>
            <h1 className="text-headline-lg text-foreground">{process.name}</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Filter, review, and retry document inference jobs for this business process.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void jobsQuery.refetch()}>
              <Icon name="sync" size={16} />
              Refresh jobs
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Total jobs" value={summary.total} caption="Matching current filters" />
          <KpiCard label="Needs review" value={summary.needsReview} caption="Confidence exceptions" />
          <KpiCard label="Failed" value={summary.failed} caption="Retry eligible" />
          <KpiCard label="Unclassified" value={summary.unclassified} caption="No matching form" />
          <KpiCard
            label="Estimated cost"
            value={formatCostUsd(summary.totalEstimatedCostUsd) ?? "$0.00"}
            caption="Filtered total"
          />
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-col gap-4 border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <SectionHeader
              title="Filters"
              description="All filters sync to the URL so this backlog view can be refreshed or shared."
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                updateFilters(clearableFilterState())
              }
              disabled={!hasActiveFilters}
            >
              <Icon name="filter_alt_off" size={16} />
              Clear filters
            </Button>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(16rem,1.2fr)_minmax(20rem,2fr)_minmax(14rem,1fr)]">
            <div className="space-y-2">
              <label htmlFor="file-name-filter" className="text-label-caps text-muted-foreground">
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

            <FilterGroup legend="Status">
              {STATUS_OPTIONS.map((status) => (
                <label key={status} className="cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label={status}
                    checked={filterState.status.includes(status)}
                    onChange={(event) => updateStatusFilter(status, event.target.checked)}
                    className="peer sr-only"
                  />
                  <FilterChip checked={filterState.status.includes(status)}>{status}</FilterChip>
                </label>
              ))}
            </FilterGroup>

            <div className="space-y-2">
              <label htmlFor="reviewed-filter" className="text-label-caps text-muted-foreground">
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
                className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="any">Any</option>
                <option value="reviewed">Reviewed</option>
                <option value="not-reviewed">Not reviewed</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <FilterGroup legend="Detected form" className="min-w-0">
              {detectedFormOptions.length > 0 ? (
                detectedFormOptions.map((option) => (
                  <label key={option.value} className="cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label={option.label}
                      checked={filterState.detectedForm.includes(option.value)}
                      onChange={(event) => updateDetectedFormFilter(option.value, event.target.checked)}
                      className="peer sr-only"
                    />
                    <FilterChip checked={filterState.detectedForm.includes(option.value)}>
                      {option.label}
                    </FilterChip>
                  </label>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No detected forms available yet.</p>
              )}
            </FilterGroup>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Needs review only"
                  checked={filterState.hasViolations}
                  onChange={(event) =>
                    updateFilters({
                      ...filterState,
                      hasViolations: event.target.checked,
                    })
                  }
                  className="peer sr-only"
                />
                <FilterChip checked={filterState.hasViolations}>
                  <Icon name="flag" size={14} />
                  Needs review only
                </FilterChip>
              </label>

              <label className="cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Unclassified only"
                  checked={filterState.unclassified}
                  onChange={(event) =>
                    updateFilters({
                      ...filterState,
                      unclassified: event.target.checked,
                    })
                  }
                  className="peer sr-only"
                />
                <FilterChip checked={filterState.unclassified}>
                  <Icon name="help" size={14} />
                  Unclassified only
                </FilterChip>
              </label>

              <div className="space-y-2">
                <label htmlFor="submitted-from-filter" className="text-label-caps text-muted-foreground">
                  Submitted from
                </label>
                <Input
                  id="submitted-from-filter"
                  type="date"
                  value={filterState.submittedFromDate}
                  onChange={(event) =>
                    updateFilters({
                      ...filterState,
                      submittedFromDate: event.target.value,
                    })
                  }
                  className="h-9 bg-card"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="submitted-to-filter" className="text-label-caps text-muted-foreground">
                  Submitted to
                </label>
                <Input
                  id="submitted-to-filter"
                  type="date"
                  value={filterState.submittedToDate}
                  onChange={(event) =>
                    updateFilters({
                      ...filterState,
                      submittedToDate: event.target.value,
                    })
                  }
                  className="h-9 bg-card"
                />
              </div>
            </div>
          </div>
        </div>

        {showingCappedResults ? (
          <div className="m-4 rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning-foreground">
            Showing first {jobs.length} of {summary.total} matching jobs — narrow your filters.
          </div>
        ) : null}

        {noJobsYet ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/30 p-10 text-center">
            <h3 className="text-headline-md text-foreground">No jobs yet for this process</h3>
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
          <div className="m-4 rounded-lg border border-dashed bg-muted/30 p-10 text-center">
            <h3 className="text-headline-md text-foreground">No jobs match these filters</h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Try broadening the filters or clear them to return to the full job history.
            </p>
            <div className="mt-6">
              <Button
                type="button"
                onClick={() =>
                  updateFilters(clearableFilterState())
                }
              >
                Clear filters
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden">
            <Table className="min-w-[1080px]">
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">File name</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Submitted</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Status</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Detected form</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Field count</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Confidence</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Est. cost</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Needs review</TableHead>
                    <TableHead className="h-9 px-3 text-label-caps text-muted-foreground">Reviewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="bg-card">
                  {jobs.map((job) => {
                    const interactive = job.status === "succeeded";
                    const needsReview = Boolean(job.confidenceViolations && job.confidenceViolations.length > 0);

                    return (
                      <TableRow
                        key={job.id}
                        tabIndex={interactive ? 0 : undefined}
                        role={interactive ? "link" : undefined}
                        className={cn(
                          "align-top",
                          interactive ? "cursor-pointer focus:bg-muted/50 focus:outline-none" : "",
                        )}
                        onClick={interactive ? () => onJobActivate(job) : undefined}
                        onKeyDown={interactive ? (event) => onJobKeyDown(event, job) : undefined}
                      >
                        <TableCell className="max-w-[18rem] px-3 py-3 align-top">
                          <div className="space-y-1.5">
                            <p className="font-medium text-foreground">{job.fileName}</p>
                            {job.unclassified ? (
                              <span className="inline-flex rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                No matching form
                              </span>
                            ) : null}
                            {job.status === "failed" && job.error ? <FailedJobError error={job.error} /> : null}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-3 text-muted-foreground">{formatDateTime(job.submittedAt)}</TableCell>
                        <TableCell className="px-3 py-3 align-top">
                          <div className="space-y-2">
                            <JobStatusBadge status={job.status} />
                            {job.status === "queued" || job.status === "running" ? (
                              <ProcessingIndicator status={job.status} />
                            ) : null}
                            {job.status === "failed" && canRetryJobs ? (
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
                        </TableCell>
                        <TableCell className="px-3 py-3 text-muted-foreground">{formatDetectedForm(job)}</TableCell>
                        <TableCell className="px-3 py-3 text-muted-foreground tabular-figures">{job.fieldCount ?? 0}</TableCell>
                        <TableCell className="px-3 py-3">
                          <AverageConfidenceValue averageConfidence={job.averageConfidence} />
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <EstimatedCostValue estimatedCostUsd={job.estimatedCostUsd} />
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <NeedsReviewBadge show={needsReview} />
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <ReviewedIndicator reviewedAt={job.reviewedAt} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
            </Table>
          </div>
        )}

        {listPollingStartedAt ? (
          <div className="m-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name="info" size={14} />
            Live updates are active while queued or running jobs remain in this view.
          </div>
        ) : null}
      </section>
    </div>
  );
}
