import type { ComponentProps } from "react";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessJobsPage } from "@/components/process-jobs-page";
import { renderWithQueryClient } from "@/components/test-utils";
import {
  api,
  type BusinessProcess,
  type Job,
  type JobsSummary,
} from "@/lib/api";

const { pushMock, replaceMock, setSearch, getSearch, toastErrorMock } =
  vi.hoisted(() => {
    let currentSearch = "";

    return {
      pushMock: vi.fn(),
      replaceMock: vi.fn((href: string) => {
        const [, nextSearch = ""] = href.split("?");
        currentSearch = nextSearch;
      }),
      setSearch: (value: string) => {
        currentSearch = value.startsWith("?") ? value.slice(1) : value;
      },
      getSearch: () => currentSearch,
      toastErrorMock: vi.fn(),
    };
  });

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/processes/process-1/jobs",
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(getSearch()),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getProcess: vi.fn(),
      listJobs: vi.fn(),
      getJobsSummary: vi.fn(),
      retryJob: vi.fn(),
    },
  };
});

vi.mock("@/lib/query", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/query")>("@/lib/query");
  return {
    ...actual,
    pollingIntervals: {
      jobs: {
        fastMs: 5,
        slowMs: 10,
      },
      analyzers: {
        fastMs: 5,
        slowMs: 10,
      },
      backoffAfterMs: 20,
      timeoutMs: 200,
    },
  };
});

const mockedApi = vi.mocked(api);

const baseProcess: BusinessProcess = {
  id: "process-1",
  name: "Invoice Intake",
  description: "Routes invoices to the correct analyzer.",
  allowedAnalyzerIds: ["prebuilt-invoice"],
  allowedAnalyzers: [{ id: "prebuilt-invoice", name: "Invoice" }],
  confidenceThreshold: 0.87,
  ownerEmail: "owner@example.com",
  routingAnalyzerStatus: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const baseSummary: JobsSummary = {
  total: 1,
  needsReview: 0,
  failed: 0,
  unclassified: 0,
  totalEstimatedCostUsd: 0,
};

const baseJob: Job = {
  id: "job-1",
  processId: "process-1",
  fileName: "invoice.pdf",
  status: "succeeded",
  submittedAt: "2026-01-02T00:00:00Z",
  detectedForm: "prebuilt-invoice",
  detectedFormName: "Invoice",
  fieldCount: 4,
  estimatedCostUsd: 0.0191,
};

function renderPage() {
  return renderWithQueryClient(<ProcessJobsPage processId="process-1" />);
}

function mockSummaryResponses(filtered: JobsSummary, unfiltered = filtered) {
  mockedApi.getJobsSummary.mockImplementation(async (_processId, filters) =>
    filters ? filtered : unfiltered,
  );
}

describe("ProcessJobsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setSearch("");
    mockedApi.getProcess.mockResolvedValue(baseProcess);
    mockedApi.listJobs.mockResolvedValue([baseJob]);
    mockSummaryResponses(baseSummary);
    mockedApi.retryJob.mockResolvedValue({ jobId: "job-2" });
  });

  it("updates the URL and refetches with the synced filters", async () => {
    const view = renderPage();

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("running"));
    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/processes/process-1/jobs?status=running",
        {
          scroll: false,
        },
      );
    });
    view.rerender(<ProcessJobsPage processId="process-1" />);
    expect(await screen.findByText("Filters")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Needs review only"));
    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/processes/process-1/jobs?status=running&hasViolations=true",
        { scroll: false },
      );
    });
    view.rerender(<ProcessJobsPage processId="process-1" />);
    expect(await screen.findByText("Filters")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Reviewed"), {
      target: { value: "not-reviewed" },
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/processes/process-1/jobs?status=running&hasViolations=true&reviewed=false",
        { scroll: false },
      );
    });
    view.rerender(<ProcessJobsPage processId="process-1" />);
    expect(await screen.findByText("Filters")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Submitted from"), {
      target: { value: "2026-01-01" },
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/processes/process-1/jobs?status=running&hasViolations=true&reviewed=false&submittedFrom=2026-01-01T00%3A00%3A00.000Z",
        { scroll: false },
      );
    });
    view.rerender(<ProcessJobsPage processId="process-1" />);
    expect(await screen.findByText("Filters")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Submitted to"), {
      target: { value: "2026-01-31" },
    });
    await waitFor(() => {
      expect(replaceMock).toHaveBeenLastCalledWith(
        "/processes/process-1/jobs?status=running&hasViolations=true&reviewed=false&submittedFrom=2026-01-01T00%3A00%3A00.000Z&submittedTo=2026-01-31T23%3A59%3A59.999Z",
        { scroll: false },
      );
    });
    view.rerender(<ProcessJobsPage processId="process-1" />);
    expect(await screen.findByText("Filters")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("File name"), {
      target: { value: "invoice-2026" },
    });
    await waitFor(
      () => {
        expect(replaceMock).toHaveBeenLastCalledWith(
          "/processes/process-1/jobs?status=running&hasViolations=true&reviewed=false&fileName=invoice-2026&submittedFrom=2026-01-01T00%3A00%3A00.000Z&submittedTo=2026-01-31T23%3A59%3A59.999Z",
          { scroll: false },
        );
      },
      { timeout: 1000 },
    );
    view.rerender(<ProcessJobsPage processId="process-1" />);
    expect(await screen.findByText("Filters")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockedApi.listJobs).toHaveBeenLastCalledWith("process-1", {
        status: ["running"],
        hasViolations: true,
        reviewed: false,
        fileName: "invoice-2026",
        submittedFrom: "2026-01-01T00:00:00.000Z",
        submittedTo: "2026-01-31T23:59:59.999Z",
        detectedForm: undefined,
        unclassified: undefined,
        limit: 100,
      });
    });
    expect(mockedApi.getJobsSummary).toHaveBeenLastCalledWith("process-1", {
      status: ["running"],
      hasViolations: true,
      reviewed: false,
      fileName: "invoice-2026",
      submittedFrom: "2026-01-01T00:00:00.000Z",
      submittedTo: "2026-01-31T23:59:59.999Z",
      detectedForm: undefined,
      unclassified: undefined,
    });
  });

  it("shows the capped-results hint from summary totals instead of the row count", async () => {
    mockedApi.listJobs.mockResolvedValue([
      baseJob,
      {
        ...baseJob,
        id: "job-2",
        fileName: "invoice-2.pdf",
      },
    ]);
    mockSummaryResponses({
      total: 150,
      needsReview: 37,
      failed: 5,
      unclassified: 3,
      totalEstimatedCostUsd: 0,
    });

    renderPage();

    expect(
      await screen.findByText(
        "Showing first 2 of 150 matching jobs — narrow your filters.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("polls while jobs are running and stops after all jobs settle", async () => {
    mockedApi.listJobs
      .mockResolvedValueOnce([
        {
          ...baseJob,
          status: "running",
        },
      ])
      .mockResolvedValueOnce([baseJob])
      .mockResolvedValue([baseJob]);

    renderPage();

    expect(await screen.findByText("Processing")).toBeInTheDocument();

    await waitFor(
      () => {
        expect(mockedApi.listJobs.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 1000 },
    );
    const settledCallCount = mockedApi.listJobs.mock.calls.length;

    await waitFor(
      () => {
        expect(
          screen.queryByText(
            "Live updates are active while queued or running jobs remain in this view.",
          ),
        ).not.toBeInTheDocument();
      },
      { timeout: 1000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockedApi.listJobs).toHaveBeenCalledTimes(settledCallCount);
  });

  it("renders the no-jobs-yet empty state when the process has no jobs at all", async () => {
    mockedApi.listJobs.mockResolvedValue([]);
    mockSummaryResponses({
      total: 0,
      needsReview: 0,
      failed: 0,
      unclassified: 0,
      totalEstimatedCostUsd: 0,
    });

    renderPage();

    expect(
      await screen.findByText("No jobs yet for this process"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to process detail" }),
    ).toHaveAttribute("href", "/processes/process-1");
  });

  it("renders the no-matches empty state when filters exclude all jobs", async () => {
    setSearch("status=failed");
    mockedApi.listJobs.mockResolvedValue([]);
    mockSummaryResponses(
      {
        total: 0,
        needsReview: 0,
        failed: 0,
        unclassified: 0,
        totalEstimatedCostUsd: 0,
      },
      {
        total: 3,
        needsReview: 1,
        failed: 1,
        unclassified: 0,
        totalEstimatedCostUsd: 0,
      },
    );

    renderPage();

    expect(
      await screen.findByText("No jobs match these filters"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Clear filters" }),
    ).toHaveLength(2);
  });

  it("retries a failed job from the table", async () => {
    mockedApi.listJobs.mockResolvedValue([
      {
        ...baseJob,
        status: "failed",
        error: "Content Understanding timed out.",
      },
    ]);
    mockSummaryResponses({
      total: 1,
      needsReview: 0,
      failed: 1,
      unclassified: 0,
      totalEstimatedCostUsd: 0,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockedApi.retryJob).toHaveBeenCalledWith("process-1", "job-1");
    });
  });

  it("shows the average confidence for every job regardless of needs-review status", async () => {
    mockedApi.listJobs.mockResolvedValue([
      {
        ...baseJob,
        id: "job-1",
        averageConfidence: 0.76,
        confidenceViolations: [],
      },
      {
        ...baseJob,
        id: "job-2",
        averageConfidence: 0.42,
        confidenceViolations: ["/invoiceTotal"],
      },
      {
        ...baseJob,
        id: "job-3",
        averageConfidence: null,
        confidenceViolations: [],
      },
    ]);
    mockSummaryResponses({
      total: 3,
      needsReview: 1,
      failed: 0,
      unclassified: 0,
      totalEstimatedCostUsd: 0,
    });

    renderPage();

    await screen.findAllByText("invoice.pdf");
    expect(screen.getByText("76%")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
