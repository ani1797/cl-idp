import type { ComponentProps } from "react";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessDetailPage } from "@/components/process-detail-page";
import { renderWithSession } from "@/components/test-utils";
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

    renderWithSession(<ProcessDetailPage processId="process-1" />);

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

    renderWithSession(<ProcessDetailPage processId="process-1" />);

    expect(
      await screen.findByText("Analyzer provisioning failed in Content Understanding."),
    ).toBeInTheDocument();
  });

  it("rejects oversized and unsupported uploads client-side without calling the API", async () => {
    renderWithSession(<ProcessDetailPage processId="process-1" />);

    await screen.findByText("Invoice Intake");
    const fileInput = screen.getByLabelText("Choose documents");

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

  it("queues multiple files, uploads them, and resolves success without navigating away", async () => {
    mockedApi.triggerJob
      .mockResolvedValueOnce({ jobId: "job-1" })
      .mockResolvedValueOnce({ jobId: "job-2" });
    mockedApi.listJobs.mockResolvedValue([
      { ...baseJob, id: "job-1", fileName: "invoice.pdf", status: "succeeded", detectedFormName: "Invoice" },
      { ...baseJob, id: "job-2", fileName: "receipt.pdf", status: "succeeded", detectedFormName: "Invoice" },
    ]);

    renderWithSession(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose documents"), {
      target: {
        files: [
          new File(["pdf"], "invoice.pdf", { type: "application/pdf" }),
          new File(["pdf"], "receipt.pdf", { type: "application/pdf" }),
        ],
      },
    });

    await waitFor(() => {
      expect(mockedApi.triggerJob).toHaveBeenCalledTimes(2);
    });
    expect(mockedApi.triggerJob).toHaveBeenCalledWith("process-1", expect.any(File), "invoice.pdf");
    expect(mockedApi.triggerJob).toHaveBeenCalledWith("process-1", expect.any(File), "receipt.pdf");

    const queuePanel = await screen.findByTestId("upload-queue-panel");

    await waitFor(() => {
      expect(within(queuePanel).getAllByText("Succeeded")).toHaveLength(2);
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(within(queuePanel).getAllByRole("button", { name: "View review" })).toHaveLength(2);
  });

  it("only uploads up to the concurrency limit at a time", async () => {
    mockedApi.triggerJob.mockImplementation(() => new Promise(() => {}));

    renderWithSession(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();

    const files = Array.from({ length: 7 }, (_, index) =>
      new File(["pdf"], `invoice-${index}.pdf`, { type: "application/pdf" }),
    );

    fireEvent.change(screen.getByLabelText("Choose documents"), { target: { files } });

    await waitFor(() => {
      expect(mockedApi.triggerJob).toHaveBeenCalledTimes(5);
    });
    expect(await screen.findAllByTestId("upload-queue-row")).toHaveLength(7);
  });

  it("shows the unclassified result inline with a review link instead of navigating", async () => {
    mockedApi.triggerJob.mockResolvedValue({ jobId: "job-1" });
    mockedApi.listJobs.mockResolvedValue([
      { ...baseJob, status: "succeeded", unclassified: true, fileName: "unknown.pdf", detectedForm: null },
    ]);

    renderWithSession(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose documents"), {
      target: {
        files: [new File(["pdf"], "unknown.pdf", { type: "application/pdf" })],
      },
    });

    const queuePanel = await screen.findByTestId("upload-queue-panel");
    expect(await within(queuePanel).findByText("No matching form")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(await within(queuePanel).findByRole("button", { name: "View review" })).toBeInTheDocument();
  });

  it("keeps uploading the remaining files when one upload request fails", async () => {
    mockedApi.triggerJob
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockResolvedValueOnce({ jobId: "job-2" });
    mockedApi.listJobs.mockResolvedValue([
      { ...baseJob, id: "job-2", fileName: "receipt.pdf", status: "succeeded" },
    ]);

    renderWithSession(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose documents"), {
      target: {
        files: [
          new File(["pdf"], "invoice.pdf", { type: "application/pdf" }),
          new File(["pdf"], "receipt.pdf", { type: "application/pdf" }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Upload failed")).toBeInTheDocument();
    });
    const queuePanel = screen.getByTestId("upload-queue-panel");
    await waitFor(() => {
      expect(within(queuePanel).getByText("Succeeded")).toBeInTheDocument();
    });
  });

  it("re-queues a failed upload for retry", async () => {
    mockedApi.triggerJob.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce({ jobId: "job-9" });

    renderWithSession(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choose documents"), {
      target: { files: [new File(["pdf"], "invoice.pdf", { type: "application/pdf" })] },
    });

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(mockedApi.triggerJob).toHaveBeenCalledTimes(2);
    });
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

    renderWithSession(<ProcessDetailPage processId="process-1" />);

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("Content Understanding timed out.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(mockedApi.retryJob).toHaveBeenCalledWith("process-1", "job-1");
    });
  });
});
