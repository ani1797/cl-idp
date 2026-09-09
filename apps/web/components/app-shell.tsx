"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CircleHelp,
  Plus,
  Search,
  Settings,
  UserCircle2,
  Workflow,
} from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

function isJobsRoute(pathname: string) {
  return /^\/processes\/[^/]+\/jobs(?:\/|$)/.test(pathname);
}

function getTopbarTitle(pathname: string) {
  if (pathname === "/") {
    return "Business Processes";
  }

  if (pathname === "/processes/new") {
    return "New Process";
  }

  if (isJobsRoute(pathname)) {
    return /\/jobs\/[^/]+$/.test(pathname) ? "Inference Review" : "Process Jobs";
  }

  if (/^\/processes\/[^/]+\/edit$/.test(pathname)) {
    return "Edit Process";
  }

  if (/^\/processes\/[^/]+$/.test(pathname)) {
    return "Process Overview";
  }

  return "CL-IDP";
}

function getSearchPlaceholder(pathname: string) {
  return pathname === "/" ? "Search processes..." : "Search...";
}

type SidebarItemProps = {
  label: string;
  href?: string | null;
  active?: boolean;
  disabledReason?: string;
  description?: string;
  icon: ReactNode;
};

function SidebarItem({ label, href, active = false, disabledReason, description, icon }: SidebarItemProps) {
  const className = cn(
    "flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors",
    active
      ? "border-l-2 border-[#4f5d8c] bg-[#eef2ff] pl-3 text-[#25324d]"
      : "text-[#5d5f68] hover:bg-white hover:text-[#30323b]",
    !href && "cursor-not-allowed opacity-70 hover:bg-transparent hover:text-[#5d5f68]",
  );

  const content = (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block">{label}</span>
        {description ? <span className="mt-0.5 block text-[11px] font-normal text-[#7a7d87]">{description}</span> : null}
      </span>
    </>
  );

  if (!href) {
    return (
      <div className={className} aria-disabled="true" title={disabledReason}>
        {content}
      </div>
    );
  }

  return (
    <Link href={href} className={className} aria-current={active ? "page" : undefined} title={disabledReason}>
      {content}
    </Link>
  );
}

function AppSidebar({ pathname }: { pathname: string }) {
  const jobsIsActive = isJobsRoute(pathname);

  return (
    <aside className="border-r border-[#e1e2ed] bg-[#f7f8fc] px-4 py-6 md:min-h-screen md:sticky md:top-0">
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="flex size-10 items-center justify-center rounded-full bg-[#1f2a44] text-sm font-bold tracking-wide text-white shadow-sm">
          CL
        </div>
        <div>
          <p className="text-lg font-bold tracking-tight text-[#111827]">CL-IDP</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7a7d87]">
            Admin Console
          </p>
        </div>
      </div>

      <Link
        href="/processes/new"
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1f2a44] px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#283655]"
      >
        <Plus className="size-4" />
        <span>New Process</span>
      </Link>

      <nav aria-label="Primary" className="flex flex-col gap-1">
        <SidebarItem
          label="Processes"
          href="/"
          active={!jobsIsActive}
          icon={<Workflow className="size-4" />}
        />
        <SidebarItem
          label="Settings"
          disabledReason="Settings is not implemented in this demo."
          description="Not implemented"
          icon={<Settings className="size-4" />}
        />
      </nav>
    </aside>
  );
}

function AppTopbar({ pathname }: { pathname: string }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-4 border-b border-[#e1e2ed] bg-white px-6 py-3 lg:px-8">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7a7d87]">Shared shell</p>
        <h1 className="truncate text-lg font-semibold tracking-tight text-[#111827]">
          {getTopbarTitle(pathname)}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full border border-[#e1e2ed] bg-[#f7f8fc] px-3 py-2 text-sm text-[#7a7d87] opacity-70 sm:flex">
          <Search className="size-4" />
          <input
            type="search"
            disabled
            aria-label="Global search"
            aria-describedby="app-shell-search-note"
            placeholder={getSearchPlaceholder(pathname)}
            title="Global search is not wired to a backend endpoint in this demo."
            className="w-44 border-0 bg-transparent p-0 text-sm text-[#7a7d87] outline-none placeholder:text-[#7a7d87] disabled:cursor-not-allowed lg:w-56"
          />
        </div>
        <span id="app-shell-search-note" className="sr-only">
          Global search is not wired to a backend endpoint in this demo.
        </span>
        <button
          type="button"
          aria-label="Notifications"
          className="rounded-full p-2 text-[#5d5f68] transition-colors hover:bg-[#f4f3fa] hover:text-[#30323b]"
        >
          <Bell className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Help"
          className="rounded-full p-2 text-[#5d5f68] transition-colors hover:bg-[#f4f3fa] hover:text-[#30323b]"
        >
          <CircleHelp className="size-4" />
        </button>
        <div
          aria-label="User avatar"
          className="flex size-8 items-center justify-center rounded-full border border-[#d6d8e1] bg-[#f4f3fa] text-[#4f5d8c]"
        >
          <UserCircle2 className="size-5" />
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-foreground md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
      <AppSidebar pathname={pathname} />
      <div className="min-w-0">
        <AppTopbar pathname={pathname} />
        <main className="px-6 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
