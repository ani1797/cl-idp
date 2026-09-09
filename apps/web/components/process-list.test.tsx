import type { ComponentProps } from "react";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessListPage } from "@/components/process-list-page";
import { renderWithQueryClient } from "@/components/test-utils";
import { api, type BusinessProcess } from "@/lib/api";

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
      deleteProcess: vi.fn(),
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

describe("ProcessListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when no processes exist", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([]);

    renderWithQueryClient(<ProcessListPage />);

    expect(await screen.findByText("Create your first business process")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New Process" })).not.toHaveLength(0);
  });

  it("renders populated processes with the required columns", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([
      baseProcess,
      {
        ...baseProcess,
        id: "process-2",
        name: "Claims Intake",
        allowedAnalyzerIds: ["custom-claims", "prebuilt-invoice"],
        allowedAnalyzers: [
          { id: "custom-claims", name: "Claims Package" },
          { id: "prebuilt-invoice", name: "Invoice" },
        ],
        description: "Routes claims to the correct analyzer.",
        routingAnalyzerStatus: "building",
      },
    ]);

    renderWithQueryClient(<ProcessListPage />);

    expect(await screen.findByRole("link", { name: "Invoice Intake" })).toHaveAttribute(
      "href",
      "/processes/process-1",
    );
    expect(screen.getByText("Routes invoices to the correct analyzer.")).toBeInTheDocument();
    expect(screen.getAllByText("Invoice").length).toBeGreaterThan(0);
    expect(screen.getByText("Claims Package")).toBeInTheDocument();
    expect(screen.getAllByText("87%").length).toBe(2);
    expect(screen.getAllByText("owner@example.com").length).toBe(2);
    expect(screen.getByText("building")).toBeInTheDocument();
  });

  it("calls delete only after confirmation and skips it on cancel", async () => {
    mockedApi.listProcesses
      .mockResolvedValueOnce([baseProcess])
      .mockResolvedValueOnce([]);
    mockedApi.deleteProcess.mockResolvedValue(undefined);

    renderWithQueryClient(<ProcessListPage />);

    const deleteButton = await screen.findByRole("button", { name: /delete/i });
    fireEvent.click(deleteButton);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete Invoice Intake?")).toBeInTheDocument();
    expect(within(dialog).getByText(/jobs and uploaded documents/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mockedApi.deleteProcess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete process" }));

    await waitFor(() => {
      expect(mockedApi.deleteProcess.mock.calls[0]?.[0]).toBe("process-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("Invoice Intake")).not.toBeInTheDocument();
    });
  });
});
