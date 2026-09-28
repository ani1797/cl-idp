"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { ConfidenceBadge } from "@/components/brand/confidence-badge";
import { EnvironmentBadge, KpiCard, SectionHeader } from "@/components/brand/primitives";
import { ErrorCard } from "@/components/error-card";
import { AverageConfidenceValue } from "@/components/job-history-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type Analyzer, type BusinessProcess, type Job, type JobsSummary } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type StatusPresentation = {
  badgeVariant: React.ComponentProps<typeof Badge>["variant"];
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
};

type ProcessRollup = {
  process: BusinessProcess;
  summary?: JobsSummary;
  averageConfidence?: number | null;
  confidenceSampleCount: number;
  failedConfidenceCount: number;
  summaryError: boolean;
  jobsError: boolean;
};

type AnalyzerReference = {
  analyzer: Analyzer;
  processCount: number;
  processNames: string[];
};

const statusPresentation: Record<BusinessProcess["routingAnalyzerStatus"], StatusPresentation> = {
  building: {
    badgeVariant: "warning",
    icon: "progress_activity",
    label: "Building",
  },
  ready: {
    badgeVariant: "success",
    icon: "check_circle",
    label: "Ready",
  },
  failed: {
    badgeVariant: "destructive",
    icon: "error",
    label: "Failed",
  },
};

const numberFormatter = new Intl.NumberFormat();

function formatWholeNumber(value: number) {
  return numberFormatter.format(value);
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function DashboardKpiSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-8 w-24" />
          <Skeleton className="mt-3 h-4 w-40" />
        </div>
      ))}
    </section>
  );
}

function PipelineTableSkeleton() {
  return (
    <Card>
      <CardHeader className="border-b">
        <Skeleton className="h-6 w-72 max-w-full" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3" aria-busy="true">
          <div className="grid grid-cols-[minmax(0,1.8fr)_150px_120px_120px_120px_100px] gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
          {Array.from({ length: 4 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid grid-cols-[minmax(0,1.8fr)_150px_120px_120px_120px_100px] gap-3 rounded-lg border p-3"
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-5 w-full" />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ModelHealthSkeleton() {
  return (
    <Card>
      <CardHeader className="border-b">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3" aria-busy="true">
          <div className="rounded-lg border bg-muted/20 p-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
          <div className="col-span-2 space-y-3 pt-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-lg border p-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-2 h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyDashboardState() {
  return (
    <div className="grid gap-gutter xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>No onboarded processes yet</CardTitle>
          <CardDescription>
            This dashboard will aggregate routing throughput, confidence, and review demand once
            at least one process has been configured.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 rounded-xl border border-dashed bg-muted/20 p-margin">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-info-surface p-2 text-info">
                <Icon name="dashboard" size={20} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Nothing to aggregate yet</p>
                <p className="text-sm text-muted-foreground">
                  Process-level telemetry will appear here after the first business process is
                  onboarded and jobs begin flowing through the pipeline.
                </p>
              </div>
            </div>
            <div>
              <Button asChild>
                <Link href="/processes/new">
                  <Icon name="add_circle" size={18} />
                  Onboard a process
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Model health</CardTitle>
          <CardDescription>
            Analyzer coverage appears after processes reference configured form models.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            No analyzer-to-process mappings yet.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RoutingStatusBadge({ process }: { process: BusinessProcess }) {
  const presentation = statusPresentation[process.routingAnalyzerStatus];

  return (
    <div className="space-y-2">
      <Badge variant={presentation.badgeVariant} className="w-fit">
        <Icon
          name={presentation.icon}
          size={14}
          className={process.routingAnalyzerStatus === "building" ? "animate-spin" : undefined}
        />
        {presentation.label}
      </Badge>
      {process.routingAnalyzerError ? (
        <p className="max-w-56 text-xs text-muted-foreground">{process.routingAnalyzerError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {process.allowedAnalyzers.length} linked{" "}
          {process.allowedAnalyzers.length === 1 ? "analyzer" : "analyzers"}
        </p>
      )}
    </div>
  );
}

function ProcessPipelineTable({ processRows }: { processRows: ProcessRollup[] }) {
  const unavailableSummaryCount = processRows.filter((row) => row.summaryError).length;
  const unavailableConfidenceCount = processRows.filter((row) => row.jobsError).length;

  return (
    <Card>
      <CardHeader className="border-b">
        <SectionHeader
          title="Onboarded process pipeline"
          description="Execution status, job volume, and confidence performance across every configured workflow."
          actions={
            <Button asChild variant="outline">
              <Link href="/">
                <Icon name="account_tree" size={18} />
                Manage processes
              </Link>
            </Button>
          }
        />
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="py-3">Process</TableHead>
              <TableHead className="py-3">Status</TableHead>
              <TableHead className="py-3 text-right">Jobs processed</TableHead>
              <TableHead className="py-3 text-right">Needs attention</TableHead>
              <TableHead className="py-3 text-right">Avg confidence</TableHead>
              <TableHead className="py-3 text-right">Queue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processRows.map((row) => {
              const attentionCount = row.summary
                ? row.summary.needsReview + row.summary.unclassified
                : null;
              const processAnalyzers = row.process.allowedAnalyzers.slice(0, 2);
              const extraAnalyzerCount = Math.max(row.process.allowedAnalyzers.length - processAnalyzers.length, 0);

              return (
                <TableRow key={row.process.id} className="align-top">
                  <TableCell className="py-3">
                    <div className="space-y-2">
                      <div>
                        <p className="font-medium text-foreground">{row.process.name}</p>
                        <p className="text-sm text-muted-foreground">{row.process.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {processAnalyzers.map((analyzer) => (
                          <Badge key={analyzer.id} variant="neutral">
                            <Icon name="description" size={14} />
                            {analyzer.name}
                          </Badge>
                        ))}
                        {extraAnalyzerCount > 0 ? (
                          <Badge variant="outline">+{extraAnalyzerCount} more</Badge>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <RoutingStatusBadge process={row.process} />
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    {row.summaryError ? (
                      <span className="text-sm text-muted-foreground">Unavailable</span>
                    ) : (
                      <div className="space-y-1">
                        <p className="tabular-figures font-medium text-foreground">
                          {row.summary ? formatWholeNumber(row.summary.total) : "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.summary && row.summary.failed > 0
                            ? `${formatWholeNumber(row.summary.failed)} failed`
                            : "No failed jobs"}
                        </p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    {row.summaryError ? (
                      <span className="text-sm text-muted-foreground">Unavailable</span>
                    ) : attentionCount !== null ? (
                      <div className="space-y-1">
                        <p className="tabular-figures font-medium text-foreground">
                          {formatWholeNumber(attentionCount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.summary && row.summary.needsReview > 0
                            ? `${formatWholeNumber(row.summary.needsReview)} review flags`
                            : row.summary && row.summary.unclassified > 0
                              ? `${formatWholeNumber(row.summary.unclassified)} unclassified`
                              : "No open review work"}
                        </p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    {row.jobsError ? (
                      <span className="text-sm text-muted-foreground">Unavailable</span>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <AverageConfidenceValue averageConfidence={row.averageConfidence} />
                        <p className="text-xs text-muted-foreground">
                          {row.confidenceSampleCount > 0
                            ? `${formatWholeNumber(row.confidenceSampleCount)} scored jobs`
                            : row.failedConfidenceCount > 0
                              ? `${formatWholeNumber(row.failedConfidenceCount)} jobs without scores`
                              : "Awaiting completed jobs"}
                        </p>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/processes/${row.process.id}/jobs`}>
                        View jobs
                        <Icon name="arrow_forward" size={16} />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {unavailableSummaryCount > 0 || unavailableConfidenceCount > 0 ? (
          <div className="border-t pt-3 text-xs text-muted-foreground">
            {unavailableSummaryCount > 0 ? `${unavailableSummaryCount} summary feed unavailable.` : null}
            {unavailableSummaryCount > 0 && unavailableConfidenceCount > 0 ? " " : null}
            {unavailableConfidenceCount > 0
              ? `${unavailableConfidenceCount} confidence feed unavailable.`
              : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ModelHealthPanel({
  analyzers,
  isLoading,
  isError,
  processRows,
}: {
  analyzers: AnalyzerReference[];
  isLoading: boolean;
  isError: boolean;
  processRows: ProcessRollup[];
}) {
  const totalLinks = analyzers.reduce((sum, analyzer) => sum + analyzer.processCount, 0);
  const activeAnalyzers = analyzers.filter((analyzer) => analyzer.processCount > 0);
  const reviewHotspots = processRows.filter(
    (row) => (row.summary?.needsReview ?? 0) + (row.summary?.unclassified ?? 0) > 0,
  ).length;

  return (
    <Card>
      <CardHeader className="border-b">
        <SectionHeader
          title="Model health"
          description="Analyzer coverage derived from configured form models because job summaries do not expose per-model telemetry."
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-label-caps text-muted-foreground">Active analyzers</p>
            <p className="tabular-figures mt-2 text-2xl font-semibold text-foreground">
              {formatWholeNumber(activeAnalyzers.length)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatWholeNumber(totalLinks)} process references
            </p>
          </div>
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-label-caps text-muted-foreground">Review hotspots</p>
            <p className="tabular-figures mt-2 text-2xl font-semibold text-foreground">
              {formatWholeNumber(reviewHotspots)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Processes with open review work</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-xl border p-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-2 h-4 w-full" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Analyzer inventory could not be loaded.
          </div>
        ) : activeAnalyzers.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            No process-to-analyzer mappings are available yet.
          </div>
        ) : (
          <div className="space-y-3">
            {activeAnalyzers.map((entry) => (
              <div key={entry.analyzer.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{entry.analyzer.name}</p>
                      <Badge variant={entry.analyzer.kind === "custom" ? "secondary" : "neutral"}>
                        {entry.analyzer.kind}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{entry.analyzer.id}</p>
                  </div>
                  <Badge variant="outline">
                    {formatWholeNumber(entry.processCount)}{" "}
                    {pluralize(entry.processCount, "process", "processes")}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Used by {entry.processNames.join(", ")}.
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const processesQuery = useQuery({
    queryKey: queryKeys.processes.all,
    queryFn: api.listProcesses,
  });

  const processes = useMemo(() => processesQuery.data ?? [], [processesQuery.data]);

  const summaryQueries = useQueries({
    queries: processes.map((process) => ({
      queryKey: [...queryKeys.jobs.all(process.id), "summary", "dashboard"],
      queryFn: () => api.getJobsSummary(process.id),
      enabled: processesQuery.isSuccess,
    })),
  });

  const jobsQueries = useQueries({
    queries: processes.map((process) => ({
      queryKey: [...queryKeys.jobs.all(process.id), "list", "dashboard-confidence"],
      queryFn: () => api.listJobs(process.id),
      enabled: processesQuery.isSuccess,
    })),
  });

  const analyzersQuery = useQuery({
    queryKey: queryKeys.analyzers,
    queryFn: api.listAnalyzers,
    enabled: processesQuery.isSuccess && processes.length > 0,
  });

  const processRows = useMemo<ProcessRollup[]>(() => {
    return processes.map((process, index) => {
      const summaryQuery = summaryQueries[index];
      const jobsQuery = jobsQueries[index];
      const jobs = jobsQuery?.data ?? [];
      const confidenceValues = jobs
        .map((job) => job.averageConfidence)
        .filter((value): value is number => value !== null && value !== undefined);

      return {
        process,
        summary: summaryQuery?.data,
        averageConfidence: average(confidenceValues),
        confidenceSampleCount: confidenceValues.length,
        failedConfidenceCount: jobs.length - confidenceValues.length,
        summaryError: Boolean(summaryQuery?.isError),
        jobsError: Boolean(jobsQuery?.isError),
      };
    });
  }, [jobsQueries, processes, summaryQueries]);

  const fleetMetrics = useMemo(() => {
    const successfulSummaries = processRows
      .map((row) => row.summary)
      .filter((summary): summary is JobsSummary => Boolean(summary));
    const successfulJobLists = jobsQueries
      .map((query) => query.data)
      .filter((jobs): jobs is Job[] => Boolean(jobs));
    const allConfidenceValues = successfulJobLists.flatMap((jobs) =>
      jobs
        .map((job) => job.averageConfidence)
        .filter((value): value is number => value !== null && value !== undefined),
    );
    const summaryErrorCount = processRows.filter((row) => row.summaryError).length;
    const confidenceErrorCount = processRows.filter((row) => row.jobsError).length;

    return {
      totalProcesses: processes.length,
      totalJobs: successfulSummaries.reduce((sum, summary) => sum + summary.total, 0),
      attentionCount: successfulSummaries.reduce(
        (sum, summary) => sum + summary.needsReview + summary.unclassified,
        0,
      ),
      failedJobs: successfulSummaries.reduce((sum, summary) => sum + summary.failed, 0),
      overallAverageConfidence: average(allConfidenceValues),
      confidenceSamples: allConfidenceValues.length,
      summaryErrorCount,
      confidenceErrorCount,
    };
  }, [jobsQueries, processRows, processes.length]);

  const analyzerReferences = useMemo<AnalyzerReference[]>(() => {
    const analyzers = analyzersQuery.data ?? [];
    const usageByAnalyzerId = new Map<string, { processCount: number; processNames: string[] }>();

    processes.forEach((process) => {
      process.allowedAnalyzers.forEach((analyzer) => {
        const current = usageByAnalyzerId.get(analyzer.id) ?? { processCount: 0, processNames: [] };
        usageByAnalyzerId.set(analyzer.id, {
          processCount: current.processCount + 1,
          processNames: [...current.processNames, process.name],
        });
      });
    });

    return analyzers
      .map((analyzer) => {
        const usage = usageByAnalyzerId.get(analyzer.id);

        return {
          analyzer,
          processCount: usage?.processCount ?? 0,
          processNames: usage?.processNames ?? [],
        };
      })
      .filter((entry) => entry.processCount > 0)
      .sort((left, right) => {
        if (right.processCount !== left.processCount) {
          return right.processCount - left.processCount;
        }

        return left.analyzer.name.localeCompare(right.analyzer.name);
      });
  }, [analyzersQuery.data, processes]);

  const summariesLoading =
    processesQuery.isSuccess && processes.length > 0 && summaryQueries.some((query) => query.isLoading);
  const jobsLoading =
    processesQuery.isSuccess && processes.length > 0 && jobsQueries.some((query) => query.isLoading);
  const kpisLoading = processes.length > 0 && (summariesLoading || jobsLoading);

  if (processesQuery.isLoading) {
    return (
      <div className="flex flex-col gap-gutter">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-6 w-28" />
          </div>
          <Skeleton className="h-5 w-full max-w-3xl" />
        </div>
        <DashboardKpiSkeleton />
        <div className="grid gap-gutter xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <PipelineTableSkeleton />
          <ModelHealthSkeleton />
        </div>
      </div>
    );
  }

  if (processesQuery.isError) {
    return (
      <ErrorCard
        title="Could not load dashboard"
        message="The process fleet could not be loaded. Please try again."
        onRetry={() => void processesQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-gutter">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-headline-lg text-foreground">System Operations Dashboard</h1>
            <EnvironmentBadge />
          </div>
          <p className="max-w-3xl text-body-md text-muted-foreground">
            Read-only rollup of process throughput, confidence quality, and model coverage across
            the onboarded Canada Life IDP estate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral" className="text-label-caps">
            {formatWholeNumber(fleetMetrics.totalProcesses)}{" "}
            {pluralize(fleetMetrics.totalProcesses, "process", "processes")}
          </Badge>
          <Badge variant="outline" className="text-label-caps">
            /dashboard
          </Badge>
        </div>
      </section>

      {kpisLoading ? (
        <DashboardKpiSkeleton />
      ) : (
        <section className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total processes"
            value={formatWholeNumber(fleetMetrics.totalProcesses)}
            caption={
              fleetMetrics.totalProcesses === 1 ? "1 onboarded workflow" : "Onboarded workflows"
            }
          />
          <KpiCard
            label="Jobs processed"
            value={formatWholeNumber(fleetMetrics.totalJobs)}
            caption={
              fleetMetrics.summaryErrorCount > 0
                ? `${formatWholeNumber(fleetMetrics.summaryErrorCount)} process summaries unavailable`
                : "Aggregated from process job summaries"
            }
          />
          <KpiCard
            label="Overall avg confidence"
            value={
              fleetMetrics.overallAverageConfidence !== null ? (
                <ConfidenceBadge value={fleetMetrics.overallAverageConfidence} showLabel />
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            caption={
              fleetMetrics.confidenceSamples > 0
                ? `${formatWholeNumber(fleetMetrics.confidenceSamples)} scored jobs`
                : fleetMetrics.confidenceErrorCount > 0
                  ? `${formatWholeNumber(fleetMetrics.confidenceErrorCount)} confidence feeds unavailable`
                  : "No completed jobs with confidence yet"
            }
          />
          <KpiCard
            label="Needs attention"
            value={formatWholeNumber(fleetMetrics.attentionCount)}
            caption={
              fleetMetrics.failedJobs > 0
                ? `${formatWholeNumber(fleetMetrics.failedJobs)} failed jobs also need triage`
                : "Confidence violations or unclassified documents"
            }
          />
        </section>
      )}

      {processes.length === 0 ? (
        <EmptyDashboardState />
      ) : (
        <div className="grid gap-gutter xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          {summariesLoading || jobsLoading ? (
            <PipelineTableSkeleton />
          ) : (
            <ProcessPipelineTable processRows={processRows} />
          )}
          {analyzersQuery.isLoading ? (
            <ModelHealthSkeleton />
          ) : (
            <ModelHealthPanel
              analyzers={analyzerReferences}
              isLoading={analyzersQuery.isLoading}
              isError={analyzersQuery.isError}
              processRows={processRows}
            />
          )}
        </div>
      )}
    </div>
  );
}
