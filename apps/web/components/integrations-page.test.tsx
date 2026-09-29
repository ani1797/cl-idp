import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntegrationsPage } from "@/components/integrations-page";
import { renderWithSession } from "@/components/test-utils";
import { ApiError, api, type ApiToken, type BusinessProcess } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      listProcesses: vi.fn(),
      getAuthToken: vi.fn(),
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

const mintedToken: ApiToken = {
  accessToken: "user-token-value-123",
  tokenType: "Bearer",
  expiresIn: 3600,
};

function authPreviewRegion() {
  return screen.getByTestId("auth-preview");
}

describe("IntegrationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("shows the loading state while the process catalog is pending", () => {
    mockedApi.listProcesses.mockReturnValue(new Promise<BusinessProcess[]>(() => {}));

    const { container } = renderWithSession(<IntegrationsPage />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows an error card when the process catalog fails", async () => {
    mockedApi.listProcesses.mockRejectedValue(
      new ApiError(400, { code: "bad_request", message: "boom" }),
    );

    renderWithSession(<IntegrationsPage />);

    expect(
      await screen.findByText(/The process catalog could not be loaded/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the empty state when no processes exist", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([]);

    renderWithSession(<IntegrationsPage />);

    expect(await screen.findByText("No integration targets available")).toBeInTheDocument();
    expect(
      screen.getByText(/Create a business process first\. This screen documents the real process-driven API surface/i),
    ).toBeInTheDocument();
  });

  it("switches the selected process from the single dropdown selector", async () => {
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

    renderWithSession(<IntegrationsPage />);

    expect(await screen.findByText("/api/processes/process-1")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("/api/processes/process-1/trigger");

    fireEvent.click(screen.getByRole("combobox", { name: "Business process" }));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("option", { name: /Claims Intake/i }));

    expect(await screen.findByText("/api/processes/process-2")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("/api/processes/process-2/trigger");
    expect(screen.getByText(/This process is not trigger-ready yet/i)).toBeInTheDocument();
  });

  it("switching endpoints updates the snippet and expected response", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([baseProcess]);

    renderWithSession(<IntegrationsPage />);

    await screen.findByText("/api/processes/process-1");
    expect(document.body).toHaveTextContent("/api/processes/process-1/trigger");

    fireEvent.click(screen.getAllByRole("button", { name: /\/processes\/\{processId\}\/jobs\/summary/i })[0]);

    expect(document.body).toHaveTextContent("/api/processes/process-1/jobs/summary?hasViolations=true");
    expect(document.body).toHaveTextContent('"totalEstimatedCostUsd": 3.84');
  });

  it("switching auth mode updates the Authorization header preview", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([baseProcess]);

    renderWithSession(<IntegrationsPage />);

    await screen.findByText("/api/processes/process-1");
    expect(authPreviewRegion()).toHaveTextContent("Authorization: Bearer <generate a token below>");

    fireEvent.click(screen.getByRole("button", { name: "Service token" }));
    await waitFor(() =>
      expect(authPreviewRegion()).toHaveTextContent("Authorization: Bearer $SERVICE_API_TOKEN"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Session cookie" }));
    await waitFor(() =>
      expect(authPreviewRegion()).toHaveTextContent(
        "No Authorization header needed — the browser sends the httpOnly cl_idp_session cookie automatically",
      ),
    );
  });

  it("copy buttons show copied feedback", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([baseProcess]);

    renderWithSession(<IntegrationsPage />);

    const copyButton = await screen.findByRole("button", { name: "Copy snippet" });
    fireEvent.click(copyButton);

    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  });

  it("generates a user token and shows it once without persistence helpers", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([baseProcess]);
    mockedApi.getAuthToken.mockResolvedValueOnce(mintedToken);

    renderWithSession(<IntegrationsPage />);

    expect(await screen.findByRole("button", { name: "Generate a token" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate a token" }));

    await waitFor(() =>
      expect(mockedApi.getAuthToken).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "correct horse battery staple",
      }),
    );

    expect(await screen.findByText(mintedToken.accessToken)).toBeInTheDocument();
    expect(screen.getByText(/Shown once for this browser session and cleared on refresh/i)).toBeInTheDocument();
  });

  it("never renders a real service token value in the try-it preview", async () => {
    mockedApi.listProcesses.mockResolvedValueOnce([baseProcess]);
    mockedApi.getAuthToken.mockResolvedValueOnce(mintedToken);

    renderWithSession(<IntegrationsPage />);

    await screen.findByRole("button", { name: "Generate a token" });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate a token" }));

    await screen.findByText(mintedToken.accessToken);

    fireEvent.click(screen.getByRole("button", { name: "Service token" }));

    expect(authPreviewRegion()).toHaveTextContent("Authorization: Bearer $SERVICE_API_TOKEN");
    expect(within(authPreviewRegion()).queryByText(mintedToken.accessToken)).toBeNull();
  });
});
