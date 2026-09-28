"use client";

import { ConfidenceBadge } from "@/components/brand/confidence-badge";
import { Badge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import { type JobStatus } from "@/lib/api";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const jobStatusPresentation: Record<JobStatus, { variant: BadgeVariant; icon: IconName }> = {
  queued: { variant: "neutral", icon: "schedule" },
  running: { variant: "info", icon: "sync" },
  succeeded: { variant: "success", icon: "check_circle" },
  failed: { variant: "destructive", icon: "error" },
};

function formatSentenceCaseLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatJobStatusLabel(status: JobStatus) {
  return formatSentenceCaseLabel(status);
}

export function formatConfidencePercent(averageConfidence?: number | null) {
  if (averageConfidence === null || averageConfidence === undefined) {
    return null;
  }

  return `${(averageConfidence * 100).toFixed(0)}%`;
}

export function AverageConfidenceValue({
  averageConfidence,
}: {
  averageConfidence?: number | null;
}) {
  if (averageConfidence === null || averageConfidence === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <ConfidenceBadge value={averageConfidence} />;
}

const costFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/**
 * Formats an estimated Azure AI Content Understanding cost (see
 * `app.pricing` on the API) for display. Best-effort estimate, not actual
 * Azure billing data.
 */
export function formatCostUsd(costUsd?: number | null) {
  if (costUsd === null || costUsd === undefined) {
    return null;
  }

  return costFormatter.format(costUsd);
}

export function EstimatedCostValue({ estimatedCostUsd }: { estimatedCostUsd?: number | null }) {
  const formatted = formatCostUsd(estimatedCostUsd);

  if (formatted === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <span className="text-foreground tabular-figures font-medium">{formatted}</span>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { variant, icon } = jobStatusPresentation[status];

  return (
    <Badge variant={variant}>
      <Icon name={icon} size={14} className={status === "running" ? "animate-spin" : undefined} />
      {formatJobStatusLabel(status)}
    </Badge>
  );
}

export function NeedsReviewBadge({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }

  return (
    <Badge variant="warning">
      <Icon name="flag" size={14} />
      Needs review
    </Badge>
  );
}

export function ReviewedIndicator({ reviewedAt }: { reviewedAt?: string }) {
  const reviewed = Boolean(reviewedAt);

  return (
    <Badge variant={reviewed ? "success" : "neutral"}>
      <Icon name={reviewed ? "task_alt" : "radio_button_unchecked"} size={14} />
      {reviewed ? "Reviewed" : "Not reviewed"}
    </Badge>
  );
}

export function ProcessingIndicator({ status }: { status: Extract<JobStatus, "queued" | "running"> }) {
  return (
    <span className="text-info inline-flex items-center gap-1.5 text-xs font-medium">
      <Icon name="progress_activity" size={14} className="animate-spin" />
      {status === "running" ? "Processing" : "Queued"}
    </span>
  );
}
