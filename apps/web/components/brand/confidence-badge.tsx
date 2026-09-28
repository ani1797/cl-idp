import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * Semantic confidence bands from the Canada Life IDP design system.
 * Colour is always paired with an icon and a text label so the meaning does
 * not rely on hue alone (WCAG 2.1 AA).
 */
export type ConfidenceBand = "pass" | "warn" | "critical";

/** Boundaries are inclusive lower bounds, expressed as percentages. */
export const CONFIDENCE_BAND_THRESHOLDS = {
  pass: 95,
  warn: 70,
} as const;

export function confidenceBandForPercent(percent: number): ConfidenceBand {
  if (percent >= CONFIDENCE_BAND_THRESHOLDS.pass) {
    return "pass";
  }

  if (percent >= CONFIDENCE_BAND_THRESHOLDS.warn) {
    return "warn";
  }

  return "critical";
}

const bandStyles: Record<ConfidenceBand, string> = {
  pass: "border-confidence-pass-border bg-confidence-pass-surface text-confidence-pass",
  warn: "border-confidence-warn-border bg-confidence-warn-surface text-confidence-warn",
  critical:
    "border-confidence-critical-border bg-confidence-critical-surface text-confidence-critical",
};

const bandIcons: Record<ConfidenceBand, IconName> = {
  pass: "check_circle",
  warn: "warning",
  critical: "error",
};

const bandLabels: Record<ConfidenceBand, string> = {
  pass: "Passed",
  warn: "Review",
  critical: "Critical",
};

/** Tailwind classes for OCR overlays: 2px outline with a 40% fill. */
export const bandOverlayStyles: Record<ConfidenceBand, string> = {
  pass: "border-confidence-pass bg-confidence-pass/40",
  warn: "border-confidence-warn bg-confidence-warn/40",
  critical: "border-confidence-critical bg-confidence-critical/40",
};

export function ConfidenceBadge({
  /** Confidence as a 0..1 float, matching the API representation. */
  value,
  showLabel = false,
  className,
}: {
  value?: number | null;
  showLabel?: boolean;
  className?: string;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="text-muted-foreground">—</span>;
  }

  const percent = Math.round(value * 100);
  const band = confidenceBandForPercent(percent);

  return (
    <span
      className={cn(
        "text-label-caps tabular-figures inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5",
        bandStyles[band],
        className,
      )}
    >
      <Icon name={bandIcons[band]} size={13} />
      <span>{percent}%</span>
      {showLabel ? <span className="font-normal normal-case">{bandLabels[band]}</span> : null}
      <span className="sr-only">{bandLabels[band]} confidence</span>
    </span>
  );
}
