"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { confidenceBandForPercent } from "@/components/brand/confidence-badge";
import { JudgeReviewBadge } from "@/components/brand/judge-badge";
import { KpiCard, SectionHeader } from "@/components/brand/primitives";
import {
  AverageConfidenceValue,
  formatDateTime,
  JobStatusBadge,
  NeedsReviewBadge,
} from "@/components/job-history-ui";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";

type QueueItem = {
  processId: string;
  processName: string;
  job: Job;
  submittedAtMs: number;
};

type AgeHeuristic = {
  label: string;
  description: string;
  variant: React.ComponentProps<typeof Badge>["variant"];
  icon: React.ComponentProps<typeof Icon>["name"];
};

function getSubmittedAtMs(submittedAt: string) {
  const submittedAtMs = new Date(submittedAt).getTime();
  return Number.isNaN(submittedAtMs) ? Number.POSITIVE_INFINITY : submittedAtMs;
}

function formatAgeCompact(submittedAt: string, now = Date.now()) {
  const submittedAtMs = new Date(submittedAt).getTime();

  if (Number.isNaN(submittedAtMs)) {
    return "—";
  }

  const elapsedMs = Math.max(0, now - submittedAtMs);
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

function getAgeHeuristic(submittedAt: string, now = Date.now()): AgeHeuristic {
  const submittedAtMs = new Date(submittedAt).getTime();

  if (Number.isNaN(submittedAtMs)) {
    return {
      label: "Unknown age",
      description: "Submitted time unavailable",
      variant: "neutral",
      icon: "schedule",
    };
  }

  const elapsedHours = (now - submittedAtMs) / 3_600_000;

  if (elapsedHours >= 24) {
    return {
      label: "Over 24h",
      description: "Oldest work first",
      variant: "destructive",
      icon: "alarm_on",
    };
  }

  if (elapsedHours >= 4) {
    return {
      label: "Over 4h",
      description: "Age-based escalation",
      variant: "warning",
      icon: "schedule",
    };
  }

  return {
    label: "Recent",
    description: "Freshly queued",
    variant: "neutral",
    icon: "history_edu",
  };
}

function formatReviewCount(count: number) {
  if (count === 1) {
    return "1 low-confidence field";
  }

  return `${count} low-confidence fields`;
}

function getConfidenceBandCounts(items: QueueItem[]) {
  return items.reduce(
    (counts, item) => {
      if (item.job.averageConfidence === null || item.job.averageConfidence === undefined) {
        counts.unscored += 1;
        return counts;
      }

      const band = confidenceBandForPercent(Math.round(item.job.averageConfidence * 100));
      counts[band] += 1;
      return counts;
    },
    { pass: 0, warn: 0, critical: 0, unscored: 0 },
  );
}

function buildQueueItems(processes: BusinessProcess[], jobsByProcess: Job[][]) {
  return processes
    .flatMap((process, index) =>
      (jobsByProcess[index] ?? []).map((job) => ({
        processId: process.id,
        processName: process.name,
        job,
        submittedAtMs: getSubmittedAtMs(job.submittedAt),
      })),
    )
    .sort((left, right) => left.submittedAtMs - right.submittedAtMs);
}

function QueueAgeBadge({ submittedAt }: { submittedAt: string }) {
  const heuristic = getAgeHeuristic(submittedAt);

  return (
    <div className="space-y-1">
      <Badge variant={heuristic.variant}>
        <Icon name={heuristic.icon} size={14} />
        {heuristic.label}
      </Badge>
      <p className="text-xs text-muted-foreground">{heuristic.description}</p>
    </div>
  );
}

export function ReviewQueuePage() {
  const processesQuery = useQuery({
    queryKey: queryKeys.processes.all,
    queryFn: api.listProcesses,
  });

  const processes = useMemo(() => processesQuery.data ?? [], [processesQuery.data]);
  const jobQueries = useQueries({
    queries: processes.map((process) => ({
      queryKey: [...queryKeys.jobs.all(process.id), "review-queue"],
      queryFn: () => api.listJobs(process.id, { hasViolations: true, reviewed: false }),
      enabled: processesQuery.isSuccess,
    })),
  });

  const jobsLoading = jobQueries.some((query) => query.isLoading || query.isPending);
  const jobsError = jobQueries.find((query) => query.isError)?.error;
  const jobsByProcess = useMemo(() => jobQueries.map((query) => query.data ?? []), [jobQueries]);
  const queueItems = useMemo(() => buildQueueItems(processes, jobsByProcess), [jobsByProcess, processes]);
  const confidenceBandCounts = useMemo(() => getConfidenceBandCounts(queueItems), [queueItems]);
  const oldestItem = queueItems[0];

  function refetchQueue() {
    void processesQuery.refetch();
    jobQueries.forEach((query) => {
      void query.refetch();
    });
  }

  if (processesQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading review queue"
        description="Gathering exception jobs across every configured business process."
      />
    );
  }

  if (processesQuery.isError) {
    return (
      <ErrorCard
        title="Could not load review queue"
        message={getErrorMessage(processesQuery.error)}
        onRetry={refetchQueue}
      />
    );
  }

  if (jobsLoading) {
    return (
      <PageLoadingState
        title="Loading review queue"
        description="Gathering exception jobs across every configured business process."
      />
    );
  }

  if (jobsError) {
    return (
      <ErrorCard
        title="Could not load review queue"
        message={getErrorMessage(jobsError)}
        onRetry={refetchQueue}
      />
    );
  }

  const queueIsClear = queueItems.length === 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-label-caps text-muted-foreground">Cross-process work queue</p>
              <Badge variant="neutral">Read only</Badge>
            </div>
            <h1 className="text-headline-lg text-foreground">Document Review Queue</h1>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
              Review-ready jobs are merged from every business process and sorted by oldest
              submission first. The age column is a queue heuristic only — the API does not expose
              a formal SLA model.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={refetchQueue}>
            <Icon name="sync" size={16} />
            Refresh queue
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Items in queue"
            value={queueItems.length}
            caption={`${processes.length} ${processes.length === 1 ? "process" : "processes"} scanned`}
          />
          <KpiCard
            label="Oldest item age"
            value={oldestItem ? formatAgeCompact(oldestItem.job.submittedAt) : "—"}
            caption={oldestItem ? formatDateTime(oldestItem.job.submittedAt) : "Queue is clear"}
          />
          <KpiCard
            label="Critical confidence"
            value={confidenceBandCounts.critical}
            caption="Below 70% average confidence"
          />
          <KpiCard
            label="Review confidence"
            value={confidenceBandCounts.warn}
            caption="70–94% average confidence"
          />
          <KpiCard
            label="Passed confidence"
            value={confidenceBandCounts.pass}
            caption={
              confidenceBandCounts.unscored > 0
                ? `${confidenceBandCounts.unscored} item${confidenceBandCounts.unscored === 1 ? "" : "s"} unscored`
                : "95%+ average confidence"
            }
          />
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <SectionHeader
            title="Unified review backlog"
            description="Violations are fetched per process, then combined into one adjudication queue."
            actions={
              <Badge variant={queueIsClear ? "success" : "warning"} className="h-8 px-3">
                <Icon name={queueIsClear ? "task_alt" : "pending_actions"} size={16} />
                {queueIsClear ? "Queue is clear" : `${queueItems.length} pending review`}
              </Badge>
            }
          />
        </div>

        {queueIsClear ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/30 p-10 text-center">
            <h2 className="text-headline-md text-foreground">Queue is clear</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              No unreviewed confidence violations are waiting across the configured business
              processes.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden">
            <Table className="min-w-[1120px]">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-label-caps text-muted-foreground">
                    Priority heuristic
                  </TableHead>
                  <TableHead className="px-3 text-label-caps text-muted-foreground">Job</TableHead>
                  <TableHead className="px-3 text-label-caps text-muted-foreground">Process</TableHead>
                  <TableHead className="px-3 text-label-caps text-muted-foreground">Document</TableHead>
                  <TableHead className="px-3 text-label-caps text-muted-foreground">Submitted</TableHead>
                  <TableHead className="px-3 text-label-caps text-muted-foreground">Status</TableHead>
                  <TableHead className="px-3 text-label-caps text-muted-foreground">Confidence</TableHead>
                  <TableHead className="px-3 text-label-caps text-muted-foreground">
                    Needs review
                  </TableHead>
                  <TableHead className="px-3 text-right text-label-caps text-muted-foreground">
                    Open
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="bg-card">
                {queueItems.map((item) => {
                  const reviewHref = `/processes/${item.processId}/jobs/${item.job.id}`;
                  const flaggedCount = item.job.confidenceViolations?.length ?? 0;

                  return (
                    <TableRow key={`${item.processId}:${item.job.id}`} className="align-top">
                      <TableCell className="px-3 py-3 align-top">
                        <QueueAgeBadge submittedAt={item.job.submittedAt} />
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top">
                        <div className="space-y-1.5">
                          <Link
                            href={reviewHref}
                            className="font-heading text-sm font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
                          >
                            {item.job.id}
                          </Link>
                          <p className="font-mono text-xs text-muted-foreground">{item.processId}</p>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top">
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{item.processName}</p>
                          <p className="text-xs text-muted-foreground">Business process owner queue</p>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[18rem] px-3 py-3 align-top whitespace-normal">
                        <div className="space-y-1.5">
                          <p className="break-words font-medium text-foreground">{item.job.fileName}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{item.job.detectedFormName || item.job.detectedForm || "Unknown form"}</span>
                            <span aria-hidden="true">•</span>
                            <span className="tabular-figures">{item.job.fieldCount ?? 0} fields</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top">
                        <div className="space-y-1">
                          <p className="text-sm text-foreground">{formatDateTime(item.job.submittedAt)}</p>
                          <p className="tabular-figures text-xs text-muted-foreground">
                            {formatAgeCompact(item.job.submittedAt)} ago
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top">
                        <div className="space-y-2">
                          <JobStatusBadge status={item.job.status} />
                          {item.job.reviewedAt ? (
                            <p className="text-xs text-muted-foreground">Previously touched</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top">
                        <AverageConfidenceValue averageConfidence={item.job.averageConfidence} />
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top">
                        <div className="space-y-2">
                          <NeedsReviewBadge show={flaggedCount > 0} />
                          <JudgeReviewBadge judge={item.job.judge} />
                          <p className="text-xs text-muted-foreground">
                            {flaggedCount > 0 ? formatReviewCount(flaggedCount) : "No active violations"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-right align-top">
                        <Button asChild size="sm">
                          <Link href={reviewHref}>
                            Open review
                            <Icon name="open_in_new" size={16} />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
