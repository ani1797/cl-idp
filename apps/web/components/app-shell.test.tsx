import type { ComponentProps } from "react";

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

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

  it("renders shared navigation links and the new process button", () => {
    navigationState.pathname = "/processes/demo/edit";

    const view = render(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );

    expect(view.getByRole("link", { name: /new process/i })).toHaveAttribute("href", "/processes/new");
    expect(view.getByRole("link", { name: /processes/i })).toHaveAttribute("href", "/");
    expect(view.queryByRole("link", { name: /^jobs/i })).toBeNull();

    expect(view.getByText(/not implemented/i)).toBeTruthy();
  });

  it("highlights Processes on non-jobs routes", () => {
    navigationState.pathname = "/processes/new";

    const view = render(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );

    expect(view.getByRole("link", { name: /processes/i })).toHaveAttribute("aria-current", "page");
  });

  it("does not highlight Processes on jobs routes", () => {
    navigationState.pathname = "/processes/demo/jobs/job-123";

    const view = render(
      <AppShell>
        <div>Page</div>
      </AppShell>,
    );

    expect(view.getByRole("link", { name: /processes/i })).not.toHaveAttribute("aria-current", "page");
  });
});
