"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Button } from "@/components/ui/button";
import { api, type BusinessProcess } from "@/lib/api";
import { showErrorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { confidenceThresholdFloatToPercent } from "@/lib/process-threshold";

const statusStyles: Record<BusinessProcess["routingAnalyzerStatus"], string> = {
  building: "border-amber-200 bg-amber-50 text-amber-700",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
};

function RoutingAnalyzerStatusBadge({ process }: { process: BusinessProcess }) {
  return (
    <div className="space-y-1">
      <span
        className={cn(
          "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize",
          statusStyles[process.routingAnalyzerStatus],
        )}
      >
        {process.routingAnalyzerStatus}
      </span>
      {process.routingAnalyzerError ? (
        <p className="text-xs text-muted-foreground">{process.routingAnalyzerError}</p>
      ) : null}
    </div>
  );
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
  const [processToDelete, setProcessToDelete] = useState<BusinessProcess | null>(null);

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

  const processes = processesQuery.data ?? [];

  return (
    <>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border bg-background p-8 shadow-sm">
          <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Process catalog
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">Business processes</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Onboard, edit, and remove the business processes that drive document routing and
                extraction for the Enterprise IDP demo.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/processes/new">
                <Plus className="size-4" />
                New Process
              </Link>
            </Button>
          </div>

          {processes.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed bg-muted/30 p-10 text-center">
              <h2 className="text-xl font-semibold tracking-tight">Create your first business process</h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                No business processes have been onboarded yet. Create one to define allowed
                analyzers, routing behavior, and notification thresholds.
              </p>
              <div className="mt-6">
                <Button asChild>
                  <Link href="/processes/new">New Process</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-8 overflow-hidden rounded-3xl border">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-sm text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Description</th>
                      <th className="px-4 py-3 font-medium">Allowed analyzers</th>
                      <th className="px-4 py-3 font-medium">Threshold</th>
                      <th className="px-4 py-3 font-medium">Owner email</th>
                      <th className="px-4 py-3 font-medium">Routing analyzer status</th>
                      <th className="px-4 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background text-sm">
                    {processes.map((process) => (
                      <tr key={process.id} className="align-top">
                        <td className="px-4 py-4">
                          <Link
                            href={`/processes/${process.id}`}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {process.name}
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{process.description}</td>
                        <td className="px-4 py-4 text-muted-foreground">
                          <div className="flex flex-wrap gap-2">
                            {process.allowedAnalyzers.map((analyzer) => (
                              <span
                                key={analyzer.id}
                                className="rounded-full border bg-muted px-2.5 py-1 text-xs"
                              >
                                {analyzer.name}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">
                          {confidenceThresholdFloatToPercent(process.confidenceThreshold)}%
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{process.ownerEmail}</td>
                        <td className="px-4 py-4">
                          <RoutingAnalyzerStatusBadge process={process} />
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/processes/${process.id}`}>
                                View
                              </Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                              <Link href={`/processes/${process.id}/edit`}>
                                <Pencil className="size-3.5" />
                                Edit
                              </Link>
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => setProcessToDelete(process)}
                            >
                              <Trash2 className="size-3.5" />
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
