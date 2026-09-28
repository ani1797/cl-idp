"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { EnvironmentBadge } from "@/components/brand/primitives";
import { Wordmark } from "@/components/brand/wordmark";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  breadcrumbsForPath,
  isChromelessRoute,
  isNavItemActive,
  navItemsForRole,
  primaryNav,
  secondaryNav,
  type NavItem,
} from "@/lib/navigation";
import { hasCapability } from "@/lib/roles";
import { cn } from "@/lib/utils";

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(item, pathname);

  const className = cn(
    // A 4px maroon left border marks the active item, per the design system.
    "flex w-full items-center gap-3 border-l-4 px-5 py-2.5 text-sm transition-colors",
    active
      ? "border-primary bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground border-transparent",
    !item.href && "cursor-not-allowed opacity-60 hover:bg-transparent",
  );

  const content = (
    <>
      <Icon name={item.icon} size={20} />
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
    </>
  );

  if (!item.href) {
    return (
      <div className={className} aria-disabled="true" title={item.disabledReason}>
        {content}
        <span className="sr-only">Not implemented</span>
      </div>
    );
  }

  return (
    <Link href={item.href} className={className} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  );
}

function AppSidebar({
  pathname,
  className,
  role,
}: {
  pathname: string;
  className?: string;
  role: string | null | undefined;
}) {
  const visiblePrimaryNav = navItemsForRole(primaryNav, role);
  const canCreateProcess = hasCapability(role, "processes:write");

  return (
    <aside
      className={cn(
        "bg-sidebar border-sidebar-border flex w-64 shrink-0 flex-col justify-between border-r py-6",
        className,
      )}
    >
      <div>
        {canCreateProcess ? (
          <div className="mb-6 px-5">
            <Button asChild size="lg" className="w-full">
              <Link href="/processes/new">
                <Icon name="add" size={18} />
                New Process
              </Link>
            </Button>
          </div>
        ) : null}

        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {visiblePrimaryNav.map((item) => (
            <SidebarLink key={item.key} item={item} pathname={pathname} />
          ))}
        </nav>
      </div>

      <nav aria-label="Secondary" className="mt-8 flex flex-col gap-0.5">
        {secondaryNav.map((item) => (
          <SidebarLink key={item.key} item={item} pathname={pathname} />
        ))}
      </nav>
    </aside>
  );
}

function UserMenu() {
  const { user, signOut } = useSession();

  if (!user) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }

  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors"
        >
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          >
            {initials || "?"}
          </span>
          <span className="hidden min-w-0 flex-col text-left leading-none lg:flex">
            <span className="text-foreground truncate text-sm font-semibold">
              {user.displayName}
            </span>
            <span className="text-label-caps text-muted-foreground mt-0.5">{user.roleLabel}</span>
          </span>
          <Icon name="expand_more" size={18} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-semibold">{user.displayName}</span>
          <span className="text-muted-foreground block truncate text-xs">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <Icon name="logout" size={16} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageToggle() {
  // Bilingual support is a design requirement; the demo has no translations
  // wired up yet, so this records intent without pretending to switch locale.
  const [language, setLanguage] = useState<"EN" | "FR">("EN");

  return (
    <div
      className="border-border hidden items-center rounded-lg border p-0.5 sm:flex"
      role="group"
      aria-label="Language"
    >
      {(["EN", "FR"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLanguage(code)}
          aria-pressed={language === code}
          title="Bilingual support is not implemented in this demo."
          className={cn(
            "text-label-caps rounded-md px-2 py-1 transition-colors",
            language === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

function AppTopbar({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="bg-card border-border sticky top-0 z-40 flex h-16 items-center gap-4 border-b px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={onOpenNav}
      >
        <Icon name="menu" size={20} />
      </Button>

      <Link href="/" className="shrink-0" aria-label="Canada Life IDP home">
        <Wordmark />
      </Link>

      <EnvironmentBadge className="hidden lg:inline-flex" />

      <div className="mx-auto hidden max-w-lg flex-1 sm:block">
        <div className="relative flex items-center">
          <Icon
            name="search"
            size={18}
            className="text-muted-foreground pointer-events-none absolute left-3"
          />
          <input
            type="search"
            disabled
            aria-label="Global search"
            placeholder="Search document ID, batch, or policyholder..."
            title="Global search is not implemented in this demo."
            className="bg-muted text-foreground placeholder:text-muted-foreground w-full rounded-lg py-1.5 pr-4 pl-9 text-sm outline-none disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <LanguageToggle />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          title="Notifications are not implemented in this demo."
          className="relative"
        >
          <Icon name="notifications" size={20} />
          <span
            aria-hidden="true"
            className="bg-primary absolute top-1.5 right-1.5 size-1.5 rounded-full"
          />
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = breadcrumbsForPath(pathname);

  if (crumbs.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span aria-hidden="true" className="text-border">
                /
              </span>
            ) : null}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-secondary transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-foreground font-medium">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [navOpen, setNavOpen] = useState(false);
  const { user } = useSession();

  // The login screen owns the full viewport and renders without chrome.
  if (isChromelessRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="bg-background min-h-screen">
      <AppTopbar onOpenNav={() => setNavOpen(true)} />

      <div className="flex">
        <AppSidebar
          pathname={pathname}
          role={user?.roleLabel}
          className="sticky top-16 hidden h-[calc(100vh-4rem)] overflow-y-auto md:flex"
        />

        {navOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/40"
              onClick={() => setNavOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex">
              <AppSidebar
                pathname={pathname}
                role={user?.roleLabel}
                className="h-full overflow-y-auto shadow-lg"
              />
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-(--container-app) px-4 py-6 lg:px-6">
            <Breadcrumbs pathname={pathname} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
