"use client";

import { type BusinessProcess } from "@/lib/api";
import { confidenceThresholdFloatToPercent } from "@/lib/process-threshold";

import { CopyButton } from "@/components/integrations/copy-button";
import { processApiBasePath } from "@/components/integrations/endpoint-catalog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const statusVariants: Record<BusinessProcess["routingAnalyzerStatus"], "success" | "warning" | "destructive"> = {
  ready: "success",
  building: "warning",
  failed: "destructive",
};

const statusIcons: Record<BusinessProcess["routingAnalyzerStatus"], "check_circle" | "progress_activity" | "error"> = {
  ready: "check_circle",
  building: "progress_activity",
  failed: "error",
};

function ProcessStatusBadge({ status }: { status: BusinessProcess["routingAnalyzerStatus"] }) {
  return (
    <Badge variant={statusVariants[status]} className="capitalize">
      <Icon
        name={statusIcons[status]}
        size={14}
        className={status === "building" ? "animate-spin" : undefined}
      />
      {status}
    </Badge>
  );
}

function CopyChip({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}:</span>
      <span className="font-mono text-foreground">{value}</span>
      <CopyButton value={value} label={copyLabel} iconOnly size="icon-xs" />
    </div>
  );
}

export function IntegrationsContextBar({
  processes,
  selectedProcess,
  onSelectProcess,
}: {
  processes: BusinessProcess[];
  selectedProcess: BusinessProcess;
  onSelectProcess: (processId: string) => void;
}) {
  const basePath = processApiBasePath(selectedProcess.id);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-end lg:gap-6">
            <div className="min-w-[260px]">
              <label
                htmlFor="integration-target-select"
                className="text-label-caps text-muted-foreground"
              >
                Business process
              </label>
              <Select value={selectedProcess.id} onValueChange={onSelectProcess}>
                <SelectTrigger
                  id="integration-target-select"
                  aria-label="Business process"
                  className="mt-2 w-full min-w-[260px] bg-card"
                >
                  <SelectValue placeholder="Choose a business process" />
                </SelectTrigger>
                <SelectContent>
                  {processes.map((process) => (
                    <SelectItem key={process.id} value={process.id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            process.routingAnalyzerStatus === "ready"
                              ? "bg-success"
                              : process.routingAnalyzerStatus === "building"
                                ? "bg-warning"
                                : "bg-destructive",
                          )}
                        />
                        <span className="truncate">{process.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ProcessStatusBadge status={selectedProcess.routingAnalyzerStatus} />
              <CopyChip label="ID" value={selectedProcess.id} copyLabel="Copy process ID" />
              <CopyChip label="Base" value={basePath} copyLabel="Copy base path" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">
              Threshold {confidenceThresholdFloatToPercent(selectedProcess.confidenceThreshold)}%
            </Badge>
            <Badge variant="neutral">
              {selectedProcess.allowedAnalyzers.length}{" "}
              {selectedProcess.allowedAnalyzers.length === 1 ? "analyzer" : "analyzers"}
            </Badge>
          </div>
        </div>

        {selectedProcess.routingAnalyzerStatus !== "ready" ? (
          <div className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning">
            <div className="flex items-start gap-2">
              <Icon
                name={selectedProcess.routingAnalyzerStatus === "failed" ? "error" : "info"}
                size={16}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium">This process is not trigger-ready yet.</p>
                <p className="mt-1">
                  Real trigger and retry requests return 409 while the routing analyzer is{" "}
                  {selectedProcess.routingAnalyzerStatus}.
                  {selectedProcess.routingAnalyzerError
                    ? ` Current error: ${selectedProcess.routingAnalyzerError}`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
