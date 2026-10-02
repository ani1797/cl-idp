import type { JudgeFinding, JudgeReview, JudgeVerdict } from "@/lib/api";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * Only "ok" and "fix" are ever rendered: the judge is a best-effort
 * pre-judgement for the human reviewer, not a verdict of its own, so an
 * "unknown"/failed outcome falls back to showing nothing rather than a
 * pill with no actionable recommendation.
 */
type RenderableVerdict = Extract<JudgeVerdict, "ok" | "fix">;

const verdictStyles: Record<RenderableVerdict, string> = {
  ok: "border-confidence-pass-border bg-confidence-pass-surface text-confidence-pass",
  fix: "border-confidence-critical-border bg-confidence-critical-surface text-confidence-critical",
};

const verdictLabels: Record<RenderableVerdict, string> = {
  ok: "OK",
  fix: "FIX",
};

function isRenderableVerdict(verdict: JudgeVerdict | undefined | null): verdict is RenderableVerdict {
  return verdict === "ok" || verdict === "fix";
}

/**
 * `JUDGE RECOMMENDS: OK | FIX` pill — the Foundry AI Agent Judge's
 * pre-judgement on whether a low-confidence field (or, at the job level,
 * the rollup across all of them) is a false positive (`OK`) or a genuine
 * extraction error (`FIX`). Purely advisory: it never replaces human
 * review, so it is always rendered alongside, never instead of, the
 * existing confidence/review UI.
 */
export function JudgeBadge({
  recommendation,
  status,
  className,
  title,
}: {
  recommendation?: JudgeVerdict | null;
  status?: JudgeReview["status"] | null;
  className?: string;
  /** Rationale shown as a hover tooltip, kept out of the pill itself to avoid clutter. */
  title?: string | null;
}) {
  if (status !== "completed" || !isRenderableVerdict(recommendation)) {
    return null;
  }

  return (
    <span
      title={title ?? undefined}
      className={cn(
        "text-label-caps tabular-figures inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5",
        verdictStyles[recommendation],
        className,
      )}
    >
      <Icon name="gavel" size={13} />
      <span>
        Judge recommends: <span className="font-semibold">{verdictLabels[recommendation]}</span>
      </span>
    </span>
  );
}

/** Convenience wrapper for the job-level rollup pill (review queue, review page header). */
export function JudgeReviewBadge({
  judge,
  className,
}: {
  judge?: JudgeReview | null;
  className?: string;
}) {
  return (
    <JudgeBadge recommendation={judge?.recommendation} status={judge?.status} className={className} />
  );
}

/** Looks up the judge's finding for a given field path, if any. */
export function findJudgeFinding(judge: JudgeReview | null | undefined, path: string): JudgeFinding | undefined {
  return judge?.findings.find((candidate) => candidate.path === path);
}

/** Convenience wrapper for a single field-level finding pill (inference review field tree). */
export function JudgeFindingBadge({
  judge,
  path,
  className,
}: {
  judge?: JudgeReview | null;
  path: string;
  className?: string;
}) {
  const finding = judge?.findings.find((candidate) => candidate.path === path);
  return (
    <JudgeBadge
      recommendation={finding?.verdict}
      status={judge?.status}
      className={className}
      title={finding?.rationale}
    />
  );
}
