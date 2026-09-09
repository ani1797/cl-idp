import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { InferenceReviewPage } from "@/components/inference-review-page";
import { renderWithQueryClient } from "@/components/test-utils";
import {
  getOverlayBounds,
  scaleBoundingBoxPoints,
} from "@/lib/inference-review";
import { api, type BusinessProcess, type Job } from "@/lib/api";

const {
  pushMock,
  replaceMock,
  setSearch,
  getSearch,
  toastErrorMock,
} = vi.hoisted(() => {
  let currentSearch = "";

  return {
    pushMock: vi.fn(),
    replaceMock: vi.fn(),
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

vi.mock("react-pdf", () => ({
  pdfjs: {
    GlobalWorkerOptions: {
      workerSrc: "",
    },
  },
  Document: ({
    children,
    onLoadSuccess,
  }: {
    children: ReactNode;
    onLoadSuccess?: (value: { numPages: number }) => void;
  }) => {
    const loadedRef = useRef(false);

    useEffect(() => {
      if (loadedRef.current) {
        return;
      }

      onLoadSuccess?.({ numPages: 2 });
      loadedRef.current = true;
    }, [onLoadSuccess]);

    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({
    pageNumber,
    onRenderSuccess,
  }: {
    pageNumber: number;
    onRenderSuccess?: () => void;
  }) => {
    const renderedRef = useRef(false);

    useEffect(() => {
      if (renderedRef.current) {
        return;
      }

      onRenderSuccess?.();
      renderedRef.current = true;
    }, [onRenderSuccess]);

    return (
      <div data-testid="pdf-page">
        <canvas />
        PDF page {pageNumber}
      </div>
    );
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      getProcess: vi.fn(),
      getJob: vi.fn(),
      getJobDocument: vi.fn(),
      reviewJob: vi.fn(),
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
      timeoutMs: 60,
    },
  };
});

const mockedApi = vi.mocked(api);

const baseProcess: BusinessProcess = {
  id: "process-1",
  name: "Invoice Intake",
  description: "Routes invoices for review.",
  allowedAnalyzerIds: ["invoice"],
  allowedAnalyzers: [{ id: "invoice", name: "Invoice" }],
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
  status: "succeeded",
  submittedAt: "2026-01-02T00:00:00Z",
  detectedForm: "invoice",
  detectedFormName: "Invoice",
  fieldCount: 4,
  reviewedAt: undefined,
  pages: [
    { page: 1, width: 8.5, height: 11, unit: "inch", angle: 0 },
    { page: 2, width: 8.5, height: 11, unit: "inch", angle: 15 },
  ],
  confidenceViolations: ["/items/0/description"],
  fields: [
    {
      name: "invoiceNumber",
      path: "/invoiceNumber",
      type: "string",
      value: "INV-001",
      confidence: 0.98,
      page: 1,
      boundingBox: [0.1, 0.1, 0.25, 0.1, 0.25, 0.15, 0.1, 0.15],
    },
    {
      name: "vendor",
      path: "/vendor",
      type: "object",
      properties: {
        name: {
          name: "name",
          path: "/vendor/name",
          type: "string",
          value: "Contoso",
          confidence: 0.96,
          page: 1,
        },
      },
    },
    {
      name: "items",
      path: "/items",
      type: "array",
      items: [
        {
          name: "0",
          path: "/items/0",
          type: "object",
          properties: {
            description: {
              name: "description",
              path: "/items/0/description",
              type: "string",
              value: "Consulting",
              confidence: 0.42,
              page: 2,
              boundingBox: [0.2, 0.3, 0.5, 0.3, 0.5, 0.36, 0.2, 0.36],
            },
            quantity: {
              name: "quantity",
              path: "/items/0/quantity",
              type: "integer",
              value: 2,
              confidence: 0.91,
              page: 2,
            },
          },
        },
      ],
    },
  ],
};

function renderPage(job: Job = baseJob) {
  mockedApi.getJob.mockResolvedValue(job);
  return renderWithQueryClient(
    <InferenceReviewPage processId="process-1" jobId={job.id} />,
  );
}

beforeAll(() => {
  Object.defineProperty(globalThis.URL, "createObjectURL", {
    writable: true,
    value: vi.fn(() => "blob:invoice"),
  });
  Object.defineProperty(globalThis.URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn(),
  });
});

describe("InferenceReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setSearch("");
    mockedApi.getProcess.mockResolvedValue(baseProcess);
    mockedApi.getJob.mockResolvedValue(baseJob);
    mockedApi.getJobDocument.mockResolvedValue(
      new Blob(["pdf"], { type: "application/pdf" }),
    );
    mockedApi.reviewJob.mockImplementation(async (_processId, _jobId, input) => ({
      ...baseJob,
      reviewedAt: "2026-01-02T01:00:00Z",
      confidenceViolations: (baseJob.confidenceViolations ?? []).filter(
        (path) => !input.fields.some((field) => field.path === path),
      ),
      fields: baseJob.fields,
    }));
    mockedApi.retryJob.mockResolvedValue({ jobId: "job-2" });
  });

  it("renders nested fields with indexed array groups and JSON pointer paths", async () => {
    renderPage();

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    expect(screen.getByText("items")).toBeInTheDocument();
    expect(screen.getByText("[0]")).toBeInTheDocument();
    expect(screen.getAllByText("/items/0/description")[0]).toBeInTheDocument();
    expect(screen.getAllByText("/vendor/name")[0]).toBeInTheDocument();
  });

  it("navigates to the field page when a field is focused", async () => {
    renderPage();

    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("/items/0/description")[0]);

    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("approves a low-confidence field, clears the warning, and enables save", async () => {
    renderPage();

    expect(await screen.findByText("Low confidence and still unreviewed")).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.queryByText("Low confidence and still unreviewed")).not.toBeInTheDocument();
    });
    expect(saveButton).toBeEnabled();
  });

  it("does not flag low-confidence fields when the job has no aggregate-gated violations", async () => {
    renderPage({
      ...baseJob,
      id: "job-aggregate-pass",
      confidenceViolations: [],
    });

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();
    expect(screen.queryByText("Low confidence and still unreviewed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("enables save after an edit even without approval", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("/vendor/name"), {
      target: { value: "Fabrikam" },
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves only touched paths and returns to the encoded jobs backlog filter", async () => {
    setSearch("?from=%2Fprocesses%2Fprocess-1%2Fjobs%3Fstatus%3Dfailed");
    renderPage();

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.change(screen.getByLabelText("/vendor/name"), {
      target: { value: "Fabrikam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedApi.reviewJob).toHaveBeenCalledWith("process-1", "job-1", {
        fields: [
          { path: "/items/0/description", value: "Consulting" },
          { path: "/vendor/name", value: "Fabrikam" },
        ],
      });
    });
    expect(pushMock).toHaveBeenCalledWith("/processes/process-1/jobs?status=failed");
  });

  it("returns to the preserved origin when Back is clicked", async () => {
    setSearch("?from=%2Fprocesses%2Fprocess-1%2Fjobs%3Fstatus%3Dfailed");
    renderPage();

    expect(await screen.findByText("Invoice Intake")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[0]);

    expect(pushMock).toHaveBeenCalledWith("/processes/process-1/jobs?status=failed");
  });

  it("shows the unclassified state with no save action", async () => {
    renderPage({
      ...baseJob,
      id: "job-unclassified",
      unclassified: true,
      detectedForm: null,
      detectedFormName: undefined,
      fields: [],
      fieldCount: 0,
      confidenceViolations: [],
    });

    expect(
      await screen.findByText("This document doesn’t match any accepted form."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload another file" })).toHaveAttribute(
      "href",
      "/processes/process-1",
    );
  });

  it("shows the zero-fields state with no save action", async () => {
    renderPage({
      ...baseJob,
      id: "job-empty",
      fields: [],
      fieldCount: 0,
      confidenceViolations: [],
    });

    expect(await screen.findByText("No fields were extracted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("shows retry for failed jobs instead of the editor", async () => {
    renderPage({
      ...baseJob,
      id: "job-failed",
      status: "failed",
      error: "Content Understanding timed out.",
      fields: undefined,
      confidenceViolations: undefined,
    });

    expect(await screen.findByText("Job failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("scales bounding boxes into expected pixel coordinates", () => {
    const points = scaleBoundingBoxPoints(
      [0.1, 0.2, 0.35, 0.2, 0.35, 0.4, 0.1, 0.4],
      800,
      1000,
    );
    const bounds = getOverlayBounds(points);

    expect(points).toEqual([
      { x: 80, y: 200 },
      { x: 280, y: 200 },
      { x: 280, y: 400 },
      { x: 80, y: 400 },
    ]);
    expect(bounds).toEqual({
      left: 80,
      top: 200,
      width: 200,
      height: 200,
    });
  });
});
