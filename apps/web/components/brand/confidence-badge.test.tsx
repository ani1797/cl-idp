import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ConfidenceBadge,
  confidenceBandForPercent,
} from "@/components/brand/confidence-badge";

describe("confidenceBandForPercent", () => {
  it("bands 95% and above as pass", () => {
    expect(confidenceBandForPercent(100)).toBe("pass");
    expect(confidenceBandForPercent(95)).toBe("pass");
  });

  it("bands 70%-94% as warn", () => {
    expect(confidenceBandForPercent(94)).toBe("warn");
    expect(confidenceBandForPercent(70)).toBe("warn");
  });

  it("bands below 70% as critical", () => {
    expect(confidenceBandForPercent(69)).toBe("critical");
    expect(confidenceBandForPercent(0)).toBe("critical");
  });
});

describe("ConfidenceBadge", () => {
  it("renders a placeholder when the value is missing", () => {
    render(<ConfidenceBadge value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the passed band with its percentage and accessible label", () => {
    render(<ConfidenceBadge value={0.98} />);
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(screen.getByText("Passed confidence")).toBeInTheDocument();
  });

  it("renders the review band for warn-range values", () => {
    render(<ConfidenceBadge value={0.8} showLabel />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("renders the critical band for low values", () => {
    render(<ConfidenceBadge value={0.4} />);
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Critical confidence")).toBeInTheDocument();
  });
});
