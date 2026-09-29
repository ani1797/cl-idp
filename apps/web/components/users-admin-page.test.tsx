import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersAdminPage } from "@/components/users-admin-page";
import { renderWithQueryClient } from "@/components/test-utils";
import { api, ApiError, type AuthUser } from "@/lib/api";

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      listUsers: vi.fn(),
      createUser: vi.fn(),
      updateUser: vi.fn(),
      resetUserPassword: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const baseUsers: AuthUser[] = [
  {
    id: "user-1",
    email: "alex@example.com",
    displayName: "Alex Morgan",
    roleLabel: "IT Admin",
    isActive: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "user-2",
    email: "jamie@example.com",
    displayName: "Jamie Chen",
    roleLabel: "Reviewer",
    isActive: false,
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
];

describe("UsersAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loading state while users are being fetched", () => {
    mockedApi.listUsers.mockImplementation(
      () => new Promise<AuthUser[]>(() => undefined),
    );

    renderWithQueryClient(<UsersAdminPage />);

    expect(screen.getByText(/Loading users/i)).toBeInTheDocument();
  });

  it("renders the empty state when no users exist", async () => {
    mockedApi.listUsers.mockResolvedValueOnce([]);

    renderWithQueryClient(<UsersAdminPage />);

    expect(await screen.findByText("Create your first user")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Create user" }).length).toBeGreaterThan(0);
  });

  it("renders the error state and retries the query", async () => {
    mockedApi.listUsers
      .mockRejectedValueOnce(new ApiError(404, { code: "not_found", message: "Missing" }))
      .mockResolvedValueOnce(baseUsers);

    renderWithQueryClient(<UsersAdminPage />);

    expect(await screen.findByText("Could not load users")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Alex Morgan")).toBeInTheDocument();
    expect(mockedApi.listUsers).toHaveBeenCalledTimes(2);
  });

  it("renders users with the required columns and badges", async () => {
    mockedApi.listUsers.mockResolvedValueOnce(baseUsers);

    renderWithQueryClient(<UsersAdminPage />);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Alex Morgan")).toBeInTheDocument();
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByText("IT Admin")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deactivate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reactivate/i })).toBeInTheDocument();
  });

  it("deactivates a user and shows a success toast", async () => {
    mockedApi.listUsers.mockResolvedValue(baseUsers);
    mockedApi.updateUser.mockResolvedValue({
      ...baseUsers[0],
      isActive: false,
    });

    renderWithQueryClient(<UsersAdminPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Deactivate/i }));

    await waitFor(() => {
      expect(mockedApi.updateUser).toHaveBeenCalledWith("user-1", { isActive: false });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("User deactivated", {
      description: "Alex Morgan is now inactive.",
    });
  });

  it("only offers the three canonical roles in the create-user role selector", async () => {
    mockedApi.listUsers.mockResolvedValueOnce([]);

    renderWithQueryClient(<UsersAdminPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Create user" }))[0]);
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("combobox", { name: /role label/i }));

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["IT Admin", "Reviewer", "End User"]);

    fireEvent.click(within(listbox).getByRole("option", { name: "Reviewer" }));
    expect(within(dialog).getByRole("combobox", { name: /role label/i })).toHaveTextContent("Reviewer");
  });

  it("validates create user input before submitting", async () => {
    mockedApi.listUsers.mockResolvedValueOnce([]);

    renderWithQueryClient(<UsersAdminPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Create user" }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("Email is required.")).toBeInTheDocument();
    expect(screen.getByText("Display name is required.")).toBeInTheDocument();
    expect(screen.getByText("Role label is required.")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(mockedApi.createUser).not.toHaveBeenCalled();
  });
});
