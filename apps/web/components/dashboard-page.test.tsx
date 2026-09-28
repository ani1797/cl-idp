import type { ComponentProps } from "react";

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "@/components/dashboard-page";
import { renderWithQueryClient } from "@/components/test-utils";
import { api, type Analyzer, type BusinessProcess, type Job, type JobsSummary } from "@/lib/api";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");

  return {
    ...actual,
    api: {
      ...actual.api,
      listProcesses: vi.fn(),
      getJobsSummary: vi.fn(),
      listJobs: vi.fn(),
      listAnalyzers: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const processes: BusinessProcess[] = [
  {
    id: "claims-intake",
    name: "Claims Intake",
    description: "Routes disability claims into the configured extraction models.",
    allowedAnalyzerIds: ["claims-form", "shared-invoice"],
    allowedAnalyzers: [
      { id: "claims-form", name: "Claims Form" },
      { id: "shared-invoice", name: "Shared Invoice" },
    ],
    confidenceThreshold: 0.9,
    ownerEmail: "claims@example.com",
    routingAnalyzerStatus: "ready",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "policy-change",
    name: "Policy Change",
    description: "Processes policy change packets and endorsements.",
    allowedAnalyzerIds: ["policy-change", "shared-invoice"],
    allowedAnalyzers: [
      { id: "policy-change", name: "Policy Change" },
      { id: "shared-invoice", name: "Shared Invoice" },
    ],
    confidenceThreshold: 0.85,
    ownerEmail: "policy@example.com",
    routingAnalyzerStatus: "building",
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
];

const summariesByProcess: Record<string, JobsSummary> = {
  "claims-intake": {
    total: 5,
    needsReview: 1,
    failed: 0,
    unclassified: 1,
    totalEstimatedCostUsd: 0.52,
  },
  "policy-change": {
    total: 3,
    needsReview: 0,
    failed: 1,
    unclassified: 0,
    totalEstimatedCostUsd: 0.17,
  },
};

const jobsByProcess: Record<string, Job[]> = {
  "claims-intake": [
    {
      id: "job-1",
      processId: "claims-intake",
      fileName: "claim-1.pdf",
      status: "succeeded",
      submittedAt: "2026-01-03T00:00:00Z",
      averageConfidence: 0.96,
      detectedForm: "claims-form",
      detectedFormName: "Claims Form",
      estimatedCostUsd: 0.05,
    },
    {
      id: "job-2",
      processId: "claims-intake",
      fileName: "claim-2.pdf",
      status: "succeeded",
      submittedAt: "2026-01-03T01:00:00Z",
      averageConfidence: 0.92,
      detectedForm: "claims-form",
      detectedFormName: "Claims Form",
      estimatedCostUsd: 0.05,
    },
  ],
  "policy-change": [
    {
      id: "job-3",
      processId: "policy-change",
      fileName: "policy-1.pdf",
      status: "succeeded",
      submittedAt: "2026-01-03T02:00:00Z",
      averageConfidence: 0.99,
      detectedForm: "policy-change",
      detectedFormName: "Policy Change",
      estimatedCostUsd: 0.06,
    },
    {
      id: "job-4",
      processId: "policy-change",
      fileName: "policy-2.pdf",
      status: "succeeded",
      submittedAt: "2026-01-03T03:00:00Z",
      averageConfidence: 0.97,
      detectedForm: "shared-invoice",
      detectedFormName: "Shared Invoice",
      estimatedCostUsd: 0.06,
    },
    {
      id: "job-5",
      processId: "policy-change",
      fileName: "policy-3.pdf",
      status: "failed",
      submittedAt: "2026-01-03T04:00:00Z",
      averageConfidence: null,
      estimatedCostUsd: 0,
      error: "OCR timeout",
    },
  ],
};

const analyzers: Analyzer[] = [
  {
    id: "claims-form",
    name: "Claims Form",
    kind: "custom",
    description: "Claims intake analyzer",
  },
  {
    id: "policy-change",
    name: "Policy Change",
    kind: "prebuilt",
    description: "Policy change analyzer",
  },
  {
    id: "shared-invoice",
    name: "Shared Invoice",
    kind: "prebuilt",
    description: "Shared invoice analyzer",
  },
];

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an empty state when no processes are onboarded", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([]);

    renderWithQueryClient(<DashboardPage />);

    expect(await screen.findByText("No onboarded processes yet")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Onboard a process/i })).toHaveAttribute(
      "href",
      "/processes/new",
    );
  });

  it("renders fleet KPIs, process pipeline rows, and analyzer coverage", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce(processes);
    mockedApi.getJobsSummary.mockImplementation(async (processId) => summariesByProcess[processId]);
    mockedApi.listJobs.mockImplementation(async (processId) => jobsByProcess[processId]);
    mockedApi.listAnalyzers.mockResolvedValueOnce(analyzers);

    renderWithQueryClient(<DashboardPage />);

    expect(await screen.findByText("System Operations Dashboard")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);

    expect(screen.getAllByText("Claims Intake").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Policy Change").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: /View jobs/i }).some((link) =>
        link.getAttribute("href") === "/processes/claims-intake/jobs",
      ),
    ).toBe(true);
    expect(
      screen.getAllByRole("link", { name: /View jobs/i }).some((link) =>
        link.getAttribute("href") === "/processes/policy-change/jobs",
      ),
    ).toBe(true);

    expect(screen.getAllByText("Shared Invoice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 processes").length).toBeGreaterThan(0);

    expect(mockedApi.getJobsSummary).toHaveBeenCalledTimes(2);
    expect(mockedApi.listJobs).toHaveBeenCalledTimes(2);
    expect(mockedApi.listAnalyzers).toHaveBeenCalledTimes(1);
  });
});
