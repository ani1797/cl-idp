import type { ComponentProps } from "react";

import { within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { renderWithSession, testUser } from "@/components/test-utils";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

describe("AppShell", () => {
  beforeEach(() => {
    navigationState.pathname = "/";
    window.localStorage.clear();
  });

  it("renders the primary navigation and the new process button", () => {
    const view = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );

    expect(view.getByRole("link", { name: /new process/i })).toHaveAttribute(
      "href",
      "/processes/new",
    );

    const primaryNav = view.getByRole("navigation", { name: /primary/i });

    expect(view.getByRole("link", { name: "Processes" })).toHaveAttribute("href", "/");
    expect(view.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(view.getByRole("link", { name: "Review Queue" })).toHaveAttribute("href", "/review-queue");
    expect(view.getByRole("link", { name: "Form Models" })).toHaveAttribute("href", "/form-models");
    expect(view.getByRole("link", { name: "API & Integrations" })).toHaveAttribute(
      "href",
      "/integrations",
    );

    // Settings is designed but intentionally unbuilt, so it renders inert.
    expect(primaryNav.querySelector('[aria-disabled="true"]')).toBeTruthy();
    expect(view.getAllByText(/not implemented/i).length).toBeGreaterThan(0);
  });

  it("highlights Processes across every process-scoped route", () => {
    for (const pathname of [
      "/",
      "/processes/new",
      "/processes/demo/edit",
      "/processes/demo/jobs",
      "/processes/demo/jobs/job-123",
    ]) {
      navigationState.pathname = pathname;

      const view = renderWithSession(
        <AppShell>
          <div>Page</div>
        </AppShell>,
      );

      const nav = within(view.getByRole("navigation", { name: /primary/i }));

      expect(nav.getByRole("link", { name: "Processes" })).toHaveAttribute("aria-current", "page");
      expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");

      view.unmount();
    }
  });

  it("highlights the section matching the current route", () => {
    navigationState.pathname = "/review-queue";

    const view = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );

    const nav = within(view.getByRole("navigation", { name: /primary/i }));

    expect(nav.getByRole("link", { name: "Review Queue" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Processes" })).not.toHaveAttribute("aria-current");
  });

  it("renders breadcrumbs for nested routes but not for the root", () => {
    navigationState.pathname = "/";

    const root = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );
    expect(root.queryByRole("navigation", { name: /breadcrumb/i })).toBeNull();
    root.unmount();

    navigationState.pathname = "/processes/demo/jobs";

    const nested = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );
    const breadcrumbs = nested.getByRole("navigation", { name: /breadcrumb/i });
    expect(breadcrumbs).toBeTruthy();
    expect(breadcrumbs.textContent).toContain("Processes");
    expect(breadcrumbs.textContent).toContain("Jobs");
  });

  it("shows the signed-in user and role in the top bar", () => {
    const view = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );

    expect(view.getByText(testUser.displayName)).toBeTruthy();
    expect(view.getByText(testUser.roleLabel)).toBeTruthy();
  });

  it("hides role-restricted nav items and the New Process button for an End User", () => {
    const view = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
      { user: { ...testUser, roleLabel: "End User" } },
    );

    expect(view.queryByRole("link", { name: /new process/i })).not.toBeInTheDocument();
    expect(view.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(view.queryByRole("link", { name: "Review Queue" })).not.toBeInTheDocument();
    expect(view.queryByRole("link", { name: "Form Models" })).not.toBeInTheDocument();
    expect(view.queryByRole("link", { name: "API & Integrations" })).not.toBeInTheDocument();
    // Still available to every signed-in role.
    expect(view.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Processes" })).toBeInTheDocument();
  });

  it("shows review/queue/model nav for a Reviewer but hides process-write and user-management items", () => {
    const view = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
      { user: { ...testUser, roleLabel: "Reviewer" } },
    );

    expect(view.queryByRole("link", { name: /new process/i })).not.toBeInTheDocument();
    expect(view.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(view.getByRole("link", { name: "Review Queue" })).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Form Models" })).toBeInTheDocument();
  });

  it("offers a sign-in link when there is no session", () => {
    const view = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
      { user: null },
    );

    expect(view.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("renders chromeless routes without the shell", () => {
    navigationState.pathname = "/login";

    const view = renderWithSession(
      <AppShell>
        <div>Page</div>
      </AppShell>,
      { user: null },
    );

    expect(view.queryByRole("navigation", { name: /primary/i })).toBeNull();
    expect(view.getByText("Page")).toBeTruthy();
  });
});
