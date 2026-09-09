"use client";

import { LoaderCircle } from "lucide-react";

import { type JobStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const jobStatusStyles: Record<JobStatus, string> = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
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

export function AverageConfidenceValue({ averageConfidence }: { averageConfidence?: number | null }) {
  const formatted = formatConfidencePercent(averageConfidence);

  if (formatted === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  return <span className="font-medium text-foreground">{formatted}</span>;
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

  return <span className="font-medium text-foreground">{formatted}</span>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
        jobStatusStyles[status],
      )}
    >
      {formatJobStatusLabel(status)}
    </span>
  );
}

export function NeedsReviewBadge({ show }: { show: boolean }) {
  if (!show) {
    return null;
  }

  return (
    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
      Needs review
    </span>
  );
}

export function ReviewedIndicator({ reviewedAt }: { reviewedAt?: string }) {
  const reviewed = Boolean(reviewedAt);

  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-xs",
        reviewed
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      {reviewed ? "Reviewed" : "Not reviewed"}
    </span>
  );
}

export function ProcessingIndicator({ status }: { status: Extract<JobStatus, "queued" | "running"> }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
      <LoaderCircle className="size-3.5 animate-spin" />
      {status === "running" ? "Processing" : "Queued"}
    </span>
  );
}
