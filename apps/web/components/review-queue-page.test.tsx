import type { ComponentProps } from "react";

import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewQueuePage } from "@/components/review-queue-page";
import { renderWithQueryClient } from "@/components/test-utils";
import { ApiError, api, type BusinessProcess, type Job } from "@/lib/api";

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
      listJobs: vi.fn(),
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

const secondProcess: BusinessProcess = {
  ...baseProcess,
  id: "process-2",
  name: "Claims Intake",
};

const baseJob: Job = {
  id: "job-1",
  processId: "process-1",
  fileName: "invoice.pdf",
  status: "succeeded",
  submittedAt: "2026-01-03T08:00:00Z",
  detectedForm: "prebuilt-invoice",
  detectedFormName: "Invoice",
  fieldCount: 4,
  averageConfidence: 0.72,
  confidenceViolations: ["/invoiceTotal"],
  estimatedCostUsd: 0.0191,
};

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("ReviewQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-03T12:00:00Z").getTime());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the loading state while the queue is being assembled", () => {
    const pending = deferredPromise<BusinessProcess[]>();
    mockedApi.listProcesses.mockReturnValue(pending.promise);

    renderWithQueryClient(<ReviewQueuePage />);

    expect(screen.getByText(/Loading review queue/i)).toBeInTheDocument();
  });

  it("fans out process jobs, sorts oldest first, and links into the review workbench", async () => {
    mockedApi.listProcesses.mockResolvedValue([baseProcess, secondProcess]);
    mockedApi.listJobs.mockImplementation(async (processId) => {
      if (processId === "process-1") {
        return [
          {
            ...baseJob,
            id: "job-newer",
            submittedAt: "2026-01-03T10:30:00Z",
            averageConfidence: 0.97,
            confidenceViolations: ["/invoiceTotal"],
          },
        ];
      }

      return [
        {
          ...baseJob,
          id: "job-oldest",
          processId: "process-2",
          fileName: "claim.pdf",
          submittedAt: "2026-01-02T06:00:00Z",
          detectedFormName: "Claim package",
          averageConfidence: 0.55,
          confidenceViolations: ["/memberId", "/serviceDate"],
        },
        {
          ...baseJob,
          id: "job-middle",
          processId: "process-2",
          fileName: "claim-followup.pdf",
          submittedAt: "2026-01-03T07:15:00Z",
          averageConfidence: 0.72,
          confidenceViolations: ["/providerName"],
        },
      ];
    });

    renderWithQueryClient(<ReviewQueuePage />);

    expect(await screen.findByRole("heading", { name: "Document Review Queue" })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedApi.listJobs).toHaveBeenCalledTimes(2);
    });
    expect(mockedApi.listJobs).toHaveBeenCalledWith("process-1", {
      hasViolations: true,
      reviewed: false,
    });
    expect(mockedApi.listJobs).toHaveBeenCalledWith("process-2", {
      hasViolations: true,
      reviewed: false,
    });

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1d 6h")).toBeInTheDocument();
    expect(screen.getByText("Below 70% average confidence")).toBeInTheDocument();
    expect(screen.getByText("70–94% average confidence")).toBeInTheDocument();
    expect(screen.getByText("95%+ average confidence")).toBeInTheDocument();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");

    expect(within(rows[1]).getByText("job-oldest")).toBeInTheDocument();
    expect(within(rows[2]).getByText("job-middle")).toBeInTheDocument();
    expect(within(rows[3]).getByText("job-newer")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Over 24h")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Over 4h")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Recent")).toBeInTheDocument();
    expect(within(rows[1]).getByText("2 low-confidence fields")).toBeInTheDocument();

    const reviewLinks = screen.getAllByRole("link", { name: /Open review/i });
    expect(reviewLinks[0]).toHaveAttribute("href", "/processes/process-2/jobs/job-oldest");
    expect(reviewLinks[1]).toHaveAttribute("href", "/processes/process-2/jobs/job-middle");
    expect(reviewLinks[2]).toHaveAttribute("href", "/processes/process-1/jobs/job-newer");
  });

  it("shows the judge recommendation pill when a job has a completed judge review", async () => {
    mockedApi.listProcesses.mockResolvedValue([baseProcess]);
    mockedApi.listJobs.mockResolvedValue([
      {
        ...baseJob,
        judge: {
          status: "completed",
          recommendation: "fix",
          findings: [],
          evaluatedAt: "2026-01-03T09:00:00Z",
          model: "gpt-4.1-mini",
        },
      },
    ]);

    renderWithQueryClient(<ReviewQueuePage />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("FIX")).toBeInTheDocument();
  });

  it("omits the judge pill when no judge review is present", async () => {
    mockedApi.listProcesses.mockResolvedValue([baseProcess]);
    mockedApi.listJobs.mockResolvedValue([baseJob]);

    renderWithQueryClient(<ReviewQueuePage />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/Judge recommends/i)).not.toBeInTheDocument();
  });

  it("shows the queue-clear state when no process has pending review work", async () => {
    mockedApi.listProcesses.mockResolvedValue([baseProcess]);
    mockedApi.listJobs.mockResolvedValue([]);

    renderWithQueryClient(<ReviewQueuePage />);

    expect(await screen.findAllByText("Queue is clear")).toHaveLength(3);
    expect(
      screen.getByText(/No unreviewed confidence violations are waiting/i),
    ).toBeInTheDocument();
  });

  it("shows the error state when a process queue fetch fails", async () => {
    mockedApi.listProcesses.mockResolvedValue([baseProcess]);
    mockedApi.listJobs.mockRejectedValue(new ApiError(400, { code: "bad_request", message: "Queue service unavailable" }));

    renderWithQueryClient(<ReviewQueuePage />);

    expect(await screen.findByText("Could not load review queue")).toBeInTheDocument();
    expect(screen.getByText("Queue service unavailable")).toBeInTheDocument();
  });
});
