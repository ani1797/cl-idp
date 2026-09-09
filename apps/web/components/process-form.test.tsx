import type { ComponentProps } from "react";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProcessForm,
  buildProcessInput,
  mapProcessToFormValues,
} from "@/components/process-form";
import { renderWithQueryClient } from "@/components/test-utils";
import {
  api,
  ApiError,
  type Analyzer,
  type BusinessProcess,
  type BusinessProcessInput,
} from "@/lib/api";
import {
  confidenceThresholdFloatToPercent,
  confidenceThresholdPercentToFloat,
} from "@/lib/process-threshold";

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
      listAnalyzers: vi.fn(),
      createProcess: vi.fn(),
      getProcess: vi.fn(),
      updateProcess: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const analyzers: Analyzer[] = [
  {
    id: "prebuilt-invoice",
    name: "Invoice",
    description: "Invoices and billing statements",
    kind: "prebuilt",
  },
  {
    id: "custom-claims",
    name: "Claims Package",
    description: "Claims intake packets",
    kind: "custom",
  },
];

const processRecord: BusinessProcess = {
  id: "process-1",
  name: "Invoice Intake",
  description: "Routes invoices to the correct analyzer.",
  allowedAnalyzerIds: ["prebuilt-invoice", "missing-analyzer"],
  allowedAnalyzers: [
    { id: "prebuilt-invoice", name: "Invoice" },
    { id: "missing-analyzer", name: "Retired Analyzer" },
  ],
  confidenceThreshold: 0.87,
  ownerEmail: "owner@example.com",
  routingAnalyzerStatus: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("ProcessForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listAnalyzers.mockResolvedValue(analyzers);
  });

  it("shows validation errors for required fields, analyzer count, and email format", async () => {
    renderWithQueryClient(<ProcessForm mode="create" />);

    await screen.findByText("Invoice");
    fireEvent.change(screen.getByLabelText("Confidence threshold (%)"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Business owner email"), {
      target: { value: "invalid-email" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save process" }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(screen.getByText("Description is required.")).toBeInTheDocument();
    expect(screen.getByText("Select at least one analyzer.")).toBeInTheDocument();
    expect(screen.getByText("Confidence threshold is required.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });


  it("validates threshold bounds", async () => {
    renderWithQueryClient(<ProcessForm mode="create" />);

    await screen.findByText("Invoice");
    fireEvent.change(screen.getByLabelText("Confidence threshold (%)"), {
      target: { value: "101" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save process" }));

    expect(
      await screen.findByText("Confidence threshold must be between 0 and 100."),
    ).toBeInTheDocument();
  });

  it("renders stale analyzer chips in edit mode when a saved analyzer is no longer available", async () => {
    mockedApi.getProcess.mockResolvedValue(processRecord);

    renderWithQueryClient(<ProcessForm mode="edit" processId="process-1" />);

    expect(
      await screen.findByText("Unavailable analyzer: missing-analyzer"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This analyzer is no longer available and will be removed if you save."),
    ).toBeInTheDocument();
  });

  it("maps a 409 save failure to the name field", async () => {
    mockedApi.createProcess.mockRejectedValue(
      new ApiError(409, { code: "duplicate_process_name", message: "Duplicate name" }),
    );

    renderWithQueryClient(<ProcessForm mode="create" />);

    await screen.findByText("Invoice");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Invoice Intake" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Routes invoices" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice/ }));
    fireEvent.change(screen.getByLabelText("Business owner email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save process" }));

    expect(await screen.findByText("Name already in use.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("converts threshold percentages to floats on save and back to percentages on load", async () => {
    expect(confidenceThresholdPercentToFloat(87)).toBe(0.87);
    expect(confidenceThresholdFloatToPercent(0.87)).toBe(87);
    expect(
      confidenceThresholdFloatToPercent(confidenceThresholdPercentToFloat(42.5)),
    ).toBe(42.5);

    const createdProcess: BusinessProcess = {
      ...processRecord,
      id: "process-2",
      allowedAnalyzerIds: ["prebuilt-invoice"],
      allowedAnalyzers: [{ id: "prebuilt-invoice", name: "Invoice" }],
      confidenceThreshold: 0.42,
      name: "Claims Intake",
    };

    mockedApi.createProcess.mockImplementation(async (input: BusinessProcessInput) => ({
      ...createdProcess,
      name: input.name,
      description: input.description,
      allowedAnalyzerIds: input.allowedAnalyzerIds,
      ownerEmail: input.ownerEmail,
      confidenceThreshold: input.confidenceThreshold,
    }));

    const createView = renderWithQueryClient(<ProcessForm mode="create" />);

    await screen.findByText("Invoice");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Claims Intake" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Routes claims" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice/ }));
    fireEvent.change(screen.getByLabelText("Confidence threshold (%)"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("Business owner email"), {
      target: { value: "claims@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save process" }));

    await waitFor(() => {
      expect(mockedApi.createProcess.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ confidenceThreshold: 0.42 }),
      );
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/processes/process-2");
    });

    createView.unmount();

    mockedApi.getProcess.mockResolvedValueOnce({
      ...processRecord,
      confidenceThreshold: 0.42,
      allowedAnalyzerIds: ["prebuilt-invoice"],
      allowedAnalyzers: [{ id: "prebuilt-invoice", name: "Invoice" }],
    });

    renderWithQueryClient(<ProcessForm mode="edit" processId="process-1" />);

    expect(await screen.findByDisplayValue("42")).toBeInTheDocument();
  });

  it("builds API input from validated form values", () => {
    expect(
      buildProcessInput({
        name: "  Process A  ",
        description: "  Description  ",
        allowedAnalyzerIds: ["prebuilt-invoice"],
        confidenceThresholdPercent: 33.33,
        ownerEmail: " owner@example.com ",
      }),
    ).toEqual({
      name: "Process A",
      description: "Description",
      allowedAnalyzerIds: ["prebuilt-invoice"],
      confidenceThreshold: 0.3333,
      ownerEmail: "owner@example.com",
    });

    expect(mapProcessToFormValues(processRecord).confidenceThresholdPercent).toBe(87);
  });
});
