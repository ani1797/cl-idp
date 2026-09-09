import type { ComponentProps } from "react";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessDetailPage } from "@/components/process-detail-page";
import { renderWithQueryClient } from "@/components/test-utils";
import { api, type BusinessProcess, type Job } from "@/lib/api";

const { pushMock, toastErrorMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
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
      deleteProcess: vi.fn(),
      triggerJob: vi.fn(),
      listJobs: vi.fn(),
      getJob: vi.fn(),
      retryJob: vi.fn(),
    },
  };
});

vi.mock("@/lib/query", async () => {
  const actual = await vi.importActual<typeof import("@/lib/query")>("@/lib/query");
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

const baseJob: Job = {
  id: "job-1",
  processId: "process-1",
  fileName: "invoice.pdf",
  status: "queued",
  submittedAt: "2026-01-02T00:00:00Z",
  detectedForm: null,
};

describe("ProcessDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getProcess.mockResolvedValue(baseProcess);
    mockedApi.listJobs.mockResolvedValue([]);
    mockedApi.getJob.mockResolvedValue(baseJob);
  });
  it("polls a building process until it renders ready", async () => {
    mockedApi.getProcess
      .mockResolvedValueOnce({
        ...baseProcess,
        routingAnalyzerStatus: "building",
      })
      .mockResolvedValueOnce(baseProcess)
      .mockResolvedValue(baseProcess);

    renderWithQueryClient(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Building")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeInTheDocument();
    });
    expect(mockedApi.getProcess).toHaveBeenCalledTimes(2);
  });

  it("shows failed routing analyzer status and inline error text", async () => {
    mockedApi.getProcess.mockResolvedValue({
      ...baseProcess,
      routingAnalyzerStatus: "failed",
      routingAnalyzerError: "Analyzer provisioning failed in Content Understanding.",
    });

    renderWithQueryClient(<ProcessDetailPage processId="process-1" />);

    expect(
      await screen.findByText("Analyzer provisioning failed in Content Understanding."),
    ).toBeInTheDocument();
  });

  it("rejects oversized and unsupported uploads client-side without calling the API", async () => {
    renderWithQueryClient(<ProcessDetailPage processId="process-1" />);

    await screen.findByText("Invoice Intake");
    const fileInput = screen.getByLabelText("Choose document");

    const oversizedFile = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "invoice.pdf", {
      type: "application/pdf",
    });

    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    expect(await screen.findByText("Files must be 20 MB or smaller.")).toBeInTheDocument();
    expect(mockedApi.triggerJob).not.toHaveBeenCalled();

    const invalidType = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [invalidType] } });

    expect(
      await screen.findByText("Only PDF, PNG, JPG, or TIFF files are supported."),
    ).toBeInTheDocument();
    expect(mockedApi.triggerJob).not.toHaveBeenCalled();
  });

  it("polls a triggered job to success and navigates to the review route", async () => {
    mockedApi.triggerJob.mockResolvedValue({ jobId: "job-1" });
    mockedApi.getJob
      .mockResolvedValueOnce(baseJob)
      .mockResolvedValueOnce({
        ...baseJob,
        status: "succeeded",
        detectedForm: "prebuilt-invoice",
        detectedFormName: "Invoice",
        unclassified: false,
      });

    renderWithQueryClient(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose document"), {
      target: {
        files: [new File(["pdf"], "invoice.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => {
      expect(mockedApi.triggerJob).toHaveBeenCalledWith(
        "process-1",
        expect.any(File),
        "invoice.pdf",
      );
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/processes/process-1/jobs/job-1");
    });
  });

  it("shows the unclassified inline message instead of navigating", async () => {
    mockedApi.triggerJob.mockResolvedValue({ jobId: "job-1" });
    mockedApi.getJob
      .mockResolvedValueOnce(baseJob)
      .mockResolvedValueOnce({
        ...baseJob,
        status: "succeeded",
        unclassified: true,
        fileName: "unknown.pdf",
        detectedForm: null,
      });

    renderWithQueryClient(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose document"), {
      target: {
        files: [new File(["pdf"], "unknown.pdf", { type: "application/pdf" })],
      },
    });

    expect(
      await screen.findByText(/didn't match any configured form for this business process/i),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("calls the retry endpoint for failed history rows", async () => {
    mockedApi.listJobs.mockResolvedValue([
      {
        ...baseJob,
        status: "failed",
        error: "Content Understanding timed out.",
      },
    ]);
    mockedApi.retryJob.mockResolvedValue({ jobId: "job-2" });
    mockedApi.getJob.mockResolvedValue({
      ...baseJob,
      id: "job-2",
      status: "queued",
    });

    renderWithQueryClient(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("Content Understanding timed out.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockedApi.retryJob).toHaveBeenCalledWith("process-1", "job-1");
    });
  });
});
