import type { ComponentProps } from "react";

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormModelsPage } from "@/components/form-models-page";
import { renderWithQueryClient } from "@/components/test-utils";
import { ApiError, api, type Analyzer, type BusinessProcess } from "@/lib/api";

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
      listAnalyzers: vi.fn(),
      listProcesses: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const connectedProcess: BusinessProcess = {
  id: "process-1",
  name: "Invoice Intake",
  description: "Routes invoices to the correct analyzer.",
  allowedAnalyzerIds: ["prebuilt-invoice", "custom-claims"],
  allowedAnalyzers: [
    { id: "prebuilt-invoice", name: "Invoice" },
    { id: "custom-claims", name: "Claims Package" },
  ],
  confidenceThreshold: 0.87,
  ownerEmail: "owner@example.com",
  routingAnalyzerStatus: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("FormModelsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loading state while catalog queries are pending", () => {
    mockedApi.listAnalyzers.mockReturnValue(new Promise(() => {}));
    mockedApi.listProcesses.mockReturnValue(new Promise(() => {}));

    renderWithQueryClient(<FormModelsPage />);

    expect(screen.getByText(/loading form models/i)).toBeInTheDocument();
    expect(screen.getByText(/fetching analyzer metadata/i)).toBeInTheDocument();
  });

  it("renders the empty state when no analyzers are returned", async () => {
    mockedApi.listAnalyzers.mockResolvedValueOnce([]);
    mockedApi.listProcesses.mockResolvedValueOnce([]);

    renderWithQueryClient(<FormModelsPage />);

    expect(await screen.findByText("No form models found")).toBeInTheDocument();
    expect(screen.getAllByText(/get \/analyzers/i).length).toBeGreaterThan(0);
  });

  it("renders analyzers, runtime metadata, and connected process links", async () => {
    const analyzers: Analyzer[] = [
      {
        id: "prebuilt-invoice",
        name: "Invoice",
        description: "Extracts invoice headers and totals.",
        kind: "prebuilt",
        fieldSchema: {
          invoiceNumber: { type: "string" },
          vendorName: { type: "string" },
          total: { type: "number" },
        },
        baselineConfidence: 0.96,
      } as Analyzer,
      {
        id: "custom-claims",
        name: "Claims Package",
        description: "Custom analyzer for claims bundles.",
        kind: "custom",
      },
    ];

    mockedApi.listAnalyzers.mockResolvedValueOnce(analyzers);
    mockedApi.listProcesses.mockResolvedValueOnce([
      connectedProcess,
      {
        ...connectedProcess,
        id: "process-2",
        name: "Claims Intake",
        allowedAnalyzerIds: ["custom-claims"],
        allowedAnalyzers: [{ id: "custom-claims", name: "Claims Package" }],
      },
    ]);

    renderWithQueryClient(<FormModelsPage />);

    expect(await screen.findByText("Form Models")).toBeInTheDocument();
    expect(screen.getByText("Authoring actions are intentionally omitted")).toBeInTheDocument();
    expect(screen.getByText("Invoice")).toBeInTheDocument();
    expect(screen.getByText("Claims Package")).toBeInTheDocument();
    expect(screen.getByText("3 fields")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();
    expect(screen.getAllByText("Not exposed").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Invoice Intake" })[0]).toHaveAttribute(
      "href",
      "/processes/process-1",
    );
    expect(screen.getByRole("link", { name: "Claims Intake" })).toHaveAttribute(
      "href",
      "/processes/process-2",
    );
  });

  it("renders the error state when analyzer loading fails", async () => {
    mockedApi.listAnalyzers.mockRejectedValueOnce(
      new ApiError(400, {
        code: "bad_request",
        message: "Analyzer catalog is unavailable.",
      }),
    );
    mockedApi.listProcesses.mockResolvedValueOnce([]);

    renderWithQueryClient(<FormModelsPage />);

    expect(await screen.findByText("Could not load form models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
