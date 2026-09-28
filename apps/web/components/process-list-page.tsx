"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { KpiCard, SectionHeader } from "@/components/brand/primitives";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { useSession } from "@/components/providers/session-provider";
import { Badge } from "@/components/ui/badge";
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
import { api, type BusinessProcess } from "@/lib/api";
import { showErrorToast } from "@/lib/errors";
import { confidenceThresholdFloatToPercent } from "@/lib/process-threshold";
import { queryKeys } from "@/lib/query-keys";
import { hasCapability } from "@/lib/roles";

const statusBadgeVariants: Record<
  BusinessProcess["routingAnalyzerStatus"],
  "success" | "warning" | "destructive"
> = {
  building: "warning",
  ready: "success",
  failed: "destructive",
};

const statusIconNames: Record<
  BusinessProcess["routingAnalyzerStatus"],
  "check_circle" | "progress_activity" | "error"
> = {
  building: "progress_activity",
  ready: "check_circle",
  failed: "error",
};

function RoutingAnalyzerStatusBadge({ process }: { process: BusinessProcess }) {
  return (
    <div className="space-y-1">
      <Badge variant={statusBadgeVariants[process.routingAnalyzerStatus]} className="capitalize">
        <Icon name={statusIconNames[process.routingAnalyzerStatus]} size={14} />
        {process.routingAnalyzerStatus}
      </Badge>
      {process.routingAnalyzerError ? (
        <p className="max-w-64 text-xs text-muted-foreground">{process.routingAnalyzerError}</p>
      ) : null}
    </div>
  );
}

function getProcessSearchText(process: BusinessProcess) {
  return [
    process.id,
    process.name,
    process.description,
    process.ownerEmail,
    process.routingAnalyzerStatus,
    ...process.allowedAnalyzers.map((analyzer) => `${analyzer.id} ${analyzer.name}`),
  ]
    .join(" ")
    .toLowerCase();
}

function formatAveragePercent(values: number[]) {
  if (values.length === 0) {
    return "0%";
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${Math.round(average)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
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

export function ProcessListPage() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const canWriteProcesses = hasCapability(user?.roleLabel, "processes:write");
  const [processToDelete, setProcessToDelete] = useState<BusinessProcess | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BusinessProcess["routingAnalyzerStatus"]>(
    "all",
  );

  const processesQuery = useQuery({
    queryKey: queryKeys.processes.all,
    queryFn: api.listProcesses,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteProcess,
    onSuccess: (_, processId) => {
      queryClient.setQueryData<BusinessProcess[]>(queryKeys.processes.all, (current = []) =>
        current.filter((process) => process.id !== processId),
      );
      setProcessToDelete(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.processes.all });
    },
    onError: (error) => {
      showErrorToast(error, "Unable to delete process");
    },
  });

  const processes = useMemo(() => processesQuery.data ?? [], [processesQuery.data]);
  const filteredProcesses = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return processes.filter((process) => {
      const matchesSearch = normalizedSearch
        ? getProcessSearchText(process).includes(normalizedSearch)
        : true;
      const matchesStatus = statusFilter === "all" || process.routingAnalyzerStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [processes, searchTerm, statusFilter]);
  const readyProcesses = processes.filter((process) => process.routingAnalyzerStatus === "ready").length;
  const attentionProcesses = processes.filter(
    (process) => process.routingAnalyzerStatus === "building" || process.routingAnalyzerStatus === "failed",
  ).length;
  const analyzerLinks = processes.reduce(
    (total, process) => total + process.allowedAnalyzers.length,
    0,
  );
  const averageThreshold = formatAveragePercent(
    processes.map((process) => confidenceThresholdFloatToPercent(process.confidenceThreshold)),
  );
  const readyCaption =
    processes.length > 0
      ? `${Math.round((readyProcesses / processes.length) * 100)}% ready`
      : "No registered processes";
  const analyzerCaption =
    processes.length > 0
      ? `${(analyzerLinks / processes.length).toFixed(1)} avg per process`
      : "No analyzers mapped";

  if (processesQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading business processes"
        description="Fetching the current process catalog and routing analyzer status."
      />
    );
  }

  if (processesQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <ErrorCard
          title="Could not load business processes"
          message="The process list could not be loaded. Please try again."
          onRetry={() => void processesQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-gutter">
        <section className="flex flex-col gap-gutter">
          <div className="flex flex-col gap-gutter md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="text-headline-lg text-foreground">Business Processes</h1>
                <Badge variant="neutral" className="text-label-caps">
                  {processes.length} Total
                </Badge>
                <Badge variant="success" className="text-label-caps">
                  {readyProcesses} Ready
                </Badge>
              </div>
              <p className="text-body-md text-muted-foreground">
                Manage document routing processes, assigned extraction analyzers, and confidence
                thresholds for the Enterprise IDP demo.
              </p>
            </div>
            {canWriteProcesses ? (
              <Button asChild>
                <Link href="/processes/new">
                  <Icon name="add_circle" size={20} />
                  New Process
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Pipeline capacity"
              value={processes.length}
              caption={`${processes.length === 1 ? "registered process" : "registered processes"}`}
            />
            <KpiCard label="Routing readiness" value={readyProcesses} caption={readyCaption} />
            <KpiCard
              label="Average threshold"
              value={averageThreshold}
              caption="confidence required"
            />
            <KpiCard
              label="Analyzer coverage"
              value={analyzerLinks}
              caption={analyzerCaption}
            />
          </div>

          {processes.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-card p-10 text-center">
              <h2 className="text-headline-md text-foreground">Create your first business process</h2>
              <p className="mx-auto mt-3 max-w-2xl text-body-md text-muted-foreground">
                No business processes have been onboarded yet. Create one to define allowed
                analyzers, routing behavior, and notification thresholds.
              </p>
              <div className="mt-6">
                {canWriteProcesses ? (
                  <Button asChild>
                    <Link href="/processes/new">
                      <Icon name="add_circle" size={20} />
                      New Process
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border bg-card p-gutter">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative min-w-0 flex-1">
                    <Icon
                      name="search"
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      type="search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      className="pl-10"
                      placeholder="Search processes by name, ID, owner, status, or analyzer..."
                      aria-label="Search processes"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor="process-status-filter">
                      Filter by routing analyzer status
                    </label>
                    <div className="relative">
                      <select
                        id="process-status-filter"
                        value={statusFilter}
                        onChange={(event) =>
                          setStatusFilter(
                            event.target.value as "all" | BusinessProcess["routingAnalyzerStatus"],
                          )
                        }
                        className="h-8 appearance-none rounded-lg border border-input bg-background px-3 py-1 pr-9 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="all">All statuses</option>
                        <option value="ready">Ready</option>
                        <option value="building">Building</option>
                        <option value="failed">Failed</option>
                      </select>
                      <Icon
                        name="expand_more"
                        size={18}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                    </div>
                    <Badge variant={attentionProcesses > 0 ? "warning" : "success"} className="h-8 px-3">
                      <Icon name={attentionProcesses > 0 ? "pending_actions" : "task_alt"} size={16} />
                      {attentionProcesses} needing attention
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border bg-card">
                <SectionHeader
                  title="Process catalog"
                  description="Configured business processes and their routing analyzer state."
                  className="border-b px-gutter py-3"
                />
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Process definition
                      </TableHead>
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Allowed analyzers
                      </TableHead>
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Threshold
                      </TableHead>
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Owner email
                      </TableHead>
                      <TableHead className="px-gutter text-label-caps text-muted-foreground">
                        Routing status
                      </TableHead>
                      <TableHead className="px-gutter text-right text-label-caps text-muted-foreground">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProcesses.map((process) => (
                      <TableRow key={process.id} className="align-top">
                        <TableCell className="max-w-sm px-gutter py-3 whitespace-normal">
                          <div className="flex items-start gap-2">
                            <Icon
                              name="account_tree"
                              size={20}
                              className="mt-0.5 text-primary"
                            />
                            <div className="min-w-0">
                              <Link
                                href={`/processes/${process.id}`}
                                className="block font-heading text-sm font-semibold leading-tight text-foreground underline-offset-4 hover:text-primary hover:underline"
                              >
                                {process.name}
                              </Link>
                              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                                {process.description}
                              </p>
                              <p className="mt-1 font-mono text-xs text-muted-foreground">
                                {process.id}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-gutter py-3 whitespace-normal">
                          <div className="flex flex-wrap gap-2">
                            {process.allowedAnalyzers.map((analyzer) => (
                              <Badge key={analyzer.id} variant="neutral">
                                {analyzer.name}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="px-gutter py-3 tabular-figures text-foreground">
                          <Badge variant="outline">
                            {confidenceThresholdFloatToPercent(process.confidenceThreshold)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="px-gutter py-3 text-muted-foreground">
                          {process.ownerEmail}
                        </TableCell>
                        <TableCell className="px-gutter py-3">
                          <RoutingAnalyzerStatusBadge process={process} />
                          <p className="mt-2 text-xs text-muted-foreground">
                            Updated {formatDate(process.updatedAt)}
                          </p>
                        </TableCell>
                        <TableCell className="px-gutter py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`/processes/${process.id}`}>
                                View
                              </Link>
                            </Button>
                            {canWriteProcesses ? (
                              <>
                                <Button asChild variant="outline" size="sm">
                                  <Link href={`/processes/${process.id}/edit`}>
                                    <Icon name="edit" size={16} />
                                    Edit
                                  </Link>
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => setProcessToDelete(process)}
                                >
                                  <Icon name="delete" size={16} />
                                  Delete
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredProcesses.length === 0 ? (
                  <div className="border-t px-gutter py-8 text-center">
                    <p className="font-heading text-sm font-semibold text-foreground">
                      No processes match these filters.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Adjust the search term or routing analyzer status filter.
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 border-t px-gutter py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Showing {filteredProcesses.length} of {processes.length} processes
                  </span>
                  <span className="tabular-figures">Rows per page: {filteredProcesses.length}</span>
                </div>
              </div>
            </>
          )}
        </section>
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
