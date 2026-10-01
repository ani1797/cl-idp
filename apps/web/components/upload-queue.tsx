"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { summarizeQueue, type UploadQueueItem, type UploadQueueItemStatus } from "@/lib/upload-queue";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const statusPresentation: Record<UploadQueueItemStatus, { label: string; variant: BadgeVariant; icon: IconName }> = {
  pending: { label: "Waiting", variant: "neutral", icon: "schedule" },
  uploading: { label: "Uploading", variant: "info", icon: "progress_activity" },
  queued: { label: "Queued", variant: "neutral", icon: "schedule" },
  running: { label: "Processing", variant: "info", icon: "sync" },
  succeeded: { label: "Succeeded", variant: "success", icon: "check_circle" },
  unclassified: { label: "No matching form", variant: "warning", icon: "help" },
  failed: { label: "Failed", variant: "destructive", icon: "error" },
  rejected: { label: "Rejected", variant: "destructive", icon: "error" },
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(0)} KB`;
  }

  return `${(kb / 1024).toFixed(1)} MB`;
}

function UploadQueueStatusBadge({ status }: { status: UploadQueueItemStatus }) {
  const presentation = statusPresentation[status];

  return (
    <Badge variant={presentation.variant}>
      <Icon
        name={presentation.icon}
        size={14}
        className={status === "uploading" || status === "running" ? "animate-spin" : undefined}
      />
      {presentation.label}
    </Badge>
  );
}

export function UploadQueuePanel({
  items,
  onRetry,
  onReview,
  onClearCompleted,
  onClearAll,
}: {
  items: UploadQueueItem[];
  onRetry: (item: UploadQueueItem) => void;
  onReview: (item: UploadQueueItem) => void;
  onClearCompleted: () => void;
  onClearAll: () => void;
}) {
  if (items.length === 0) {
    return null;
  }

  const summary = summarizeQueue(items);
  const progressValue = summary.total === 0 ? 0 : ((summary.completed + summary.failed) / summary.total) * 100;
  const hasCompletedOrFailed = summary.completed > 0 || summary.failed > 0;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4" data-testid="upload-queue-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {summary.completed + summary.failed} of {summary.total} complete
            {summary.failed > 0 ? ` · ${summary.failed} failed` : ""}
          </p>
          <Progress value={progressValue} className="w-56" />
        </div>
        <div className="flex gap-2">
          {hasCompletedOrFailed ? (
            <Button type="button" variant="outline" size="sm" onClick={onClearCompleted}>
              Clear completed
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onClearAll}>
            Clear all
          </Button>
        </div>
      </div>

      <div className="max-h-80 space-y-2 overflow-y-auto">
        {items.map((item) => (
          <div
            key={item.id}
            data-testid="upload-queue-row"
            className="flex flex-col gap-1 rounded-md border bg-background p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-foreground" title={item.fileName}>
                  {item.fileName}
                </span>
                <span className="text-xs text-muted-foreground">{formatBytes(item.sizeBytes)}</span>
                <UploadQueueStatusBadge status={item.status} />
                {item.needsReview ? <Badge variant="warning">Needs review</Badge> : null}
              </div>
              {item.detectedFormName && item.status === "succeeded" ? (
                <p className="text-xs text-muted-foreground">Detected form: {item.detectedFormName}</p>
              ) : null}
              {item.error ? <p className="text-xs text-destructive">{item.error}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {(item.status === "succeeded" || item.status === "unclassified") && item.jobId ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onReview(item)}>
                  View review
                </Button>
              ) : null}
              {item.status === "failed" && item.file ? (
                <Button type="button" variant="outline" size="sm" onClick={() => onRetry(item)}>
                  <Icon name="refresh" size={14} />
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
