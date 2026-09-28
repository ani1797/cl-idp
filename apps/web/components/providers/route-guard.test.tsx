import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RouteGuard } from "@/components/providers/route-guard";
import { renderWithSession, testUser } from "@/components/test-utils";

const navigationState = vi.hoisted(() => ({
  pathname: "/dashboard",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ replace: navigationState.replace }),
}));

describe("RouteGuard", () => {
  beforeEach(() => {
    navigationState.pathname = "/dashboard";
    navigationState.replace.mockClear();
  });

  it("renders protected content once a session is resolved", () => {
    renderWithSession(
      <RouteGuard>
        <div>Protected content</div>
      </RouteGuard>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(navigationState.replace).not.toHaveBeenCalled();
  });

  it("redirects to /login with a next param when signed out on a protected route", () => {
    renderWithSession(
      <RouteGuard>
        <div>Protected content</div>
      </RouteGuard>,
      { user: null },
    );

    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(navigationState.replace).toHaveBeenCalledWith("/login?next=%2Fdashboard");
  });

  it("renders chromeless routes (e.g. /login) without redirecting, even when signed out", () => {
    navigationState.pathname = "/login";

    renderWithSession(
      <RouteGuard>
        <div>Login form</div>
      </RouteGuard>,
      { user: null },
    );

    expect(screen.getByText("Login form")).toBeInTheDocument();
    expect(navigationState.replace).not.toHaveBeenCalled();
  });

  it("redirects an End User away from a route that requires a capability they lack", () => {
    navigationState.pathname = "/admin/users";

    renderWithSession(
      <RouteGuard>
        <div>Users admin</div>
      </RouteGuard>,
      { user: { ...testUser, roleLabel: "End User" } },
    );

    expect(screen.queryByText("Users admin")).not.toBeInTheDocument();
    expect(navigationState.replace).toHaveBeenCalledWith("/");
  });

  it("allows an IT Admin to reach a capability-gated route", () => {
    navigationState.pathname = "/admin/users";

    renderWithSession(
      <RouteGuard>
        <div>Users admin</div>
      </RouteGuard>,
      { user: { ...testUser, roleLabel: "IT Admin" } },
    );

    expect(screen.getByText("Users admin")).toBeInTheDocument();
    expect(navigationState.replace).not.toHaveBeenCalled();
  });
});
