import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationsPage } from "@/components/integrations-page";
import { renderWithQueryClient } from "@/components/test-utils";
import { ApiError, api, type BusinessProcess } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      listProcesses: vi.fn(),
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

describe("IntegrationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the loading state while the process catalog is pending", () => {
    mockedApi.listProcesses.mockReturnValue(new Promise<BusinessProcess[]>(() => {}));

    const { container } = renderWithQueryClient(<IntegrationsPage />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows an error card when the process catalog fails", async () => {
    mockedApi.listProcesses.mockRejectedValue(
      new ApiError(400, { code: "bad_request", message: "boom" }),
    );

    renderWithQueryClient(<IntegrationsPage />);

    expect(
      await screen.findByText(/The process catalog could not be loaded/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the empty state when no processes exist", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([]);

    renderWithQueryClient(<IntegrationsPage />);

    expect(await screen.findByText("No integration targets available")).toBeInTheDocument();
    expect(
      screen.getByText(/Create a business process first\. This screen only documents/i),
    ).toBeInTheDocument();
  });

  it("renders live processes and swaps the selected process in the reference snippets", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([
      baseProcess,
      {
        ...baseProcess,
        id: "process-2",
        name: "Claims Intake",
        description: "Routes claims to the correct analyzer.",
        ownerEmail: "claims@example.com",
        allowedAnalyzerIds: ["custom-claims", "prebuilt-invoice"],
        allowedAnalyzers: [
          { id: "custom-claims", name: "Claims Package" },
          { id: "prebuilt-invoice", name: "Invoice" },
        ],
        routingAnalyzerStatus: "building",
      },
    ]);

    renderWithQueryClient(<IntegrationsPage />);

    expect((await screen.findAllByText("Invoice Intake")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Claims Intake").length).toBeGreaterThan(0);
    expect(screen.getAllByText("POST /processes/process-1/trigger").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/processes/process-1/trigger").length).toBeGreaterThan(0);

    expect(screen.getByRole("combobox", { name: "Integration target" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Claims Intake/i })[0]);

    expect((await screen.findAllByText("POST /processes/process-2/trigger")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("/processes/process-2/trigger").length).toBeGreaterThan(0);
    expect(screen.getByText("claims@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Uploads are not trigger-ready yet\./i)).toBeInTheDocument();
  });
});
