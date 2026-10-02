import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  JudgeBadge,
  JudgeFindingBadge,
  JudgeReviewBadge,
} from "@/components/brand/judge-badge";
import type { JudgeReview } from "@/lib/api";

const completedOkReview: JudgeReview = {
  status: "completed",
  recommendation: "ok",
  findings: [
    {
      path: "/invoiceTotal",
      extractedValue: "1,204.50",
      rationale: "Value matches the document.",
      verdict: "ok",
      suggestedValue: null,
    },
  ],
  evaluatedAt: "2026-01-02T00:30:00Z",
  model: "gpt-4.1-mini",
};

const completedFixReview: JudgeReview = {
  ...completedOkReview,
  recommendation: "fix",
  findings: [
    {
      path: "/invoiceTotal",
      extractedValue: "1,204.00",
      rationale: "The document shows a different amount.",
      verdict: "fix",
      suggestedValue: "1,204.00",
    },
  ],
};

describe("JudgeBadge", () => {
  it("renders nothing when status is undefined", () => {
    const { container } = render(<JudgeBadge recommendation="ok" status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when status is completed but recommendation is unknown", () => {
    const { container } = render(<JudgeBadge recommendation="unknown" status="completed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when status is failed", () => {
    const { container } = render(<JudgeBadge recommendation="unknown" status="failed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the OK pill for a completed ok recommendation", () => {
    render(<JudgeBadge recommendation="ok" status="completed" />);
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText(/Judge recommends/i)).toBeInTheDocument();
  });

  it("renders the FIX pill for a completed fix recommendation", () => {
    render(<JudgeBadge recommendation="fix" status="completed" />);
    expect(screen.getByText("FIX")).toBeInTheDocument();
  });
});

describe("JudgeReviewBadge", () => {
  it("renders nothing when judge is undefined", () => {
    const { container } = render(<JudgeReviewBadge judge={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the job-level rollup recommendation", () => {
    render(<JudgeReviewBadge judge={completedFixReview} />);
    expect(screen.getByText("FIX")).toBeInTheDocument();
  });
});

describe("JudgeFindingBadge", () => {
  it("renders nothing when no finding matches the given path", () => {
    const { container } = render(
      <JudgeFindingBadge judge={completedOkReview} path="/missingField" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the per-field finding verdict for a matching path", () => {
    render(<JudgeFindingBadge judge={completedFixReview} path="/invoiceTotal" />);
    expect(screen.getByText("FIX")).toBeInTheDocument();
  });

  it("renders the ok verdict for a matching path on a passing review", () => {
    render(<JudgeFindingBadge judge={completedOkReview} path="/invoiceTotal" />);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });
});
