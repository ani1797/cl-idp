import { type IconName } from "@/components/ui/icon";
import { hasCapability, type Capability } from "@/lib/roles";

export type NavItem = {
  key: string;
  label: string;
  icon: IconName;
  /** `null` marks a section that is designed but not yet implemented. */
  href: string | null;
  /** Additional path prefixes that should light this item up. */
  matchPrefixes?: string[];
  disabledReason?: string;
  /** When set, the item (and its route) is only visible/reachable to roles with this capability. */
  capability?: Capability;
};

export const primaryNav: NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    href: "/dashboard",
  },
  {
    key: "processes",
    label: "Processes",
    icon: "account_tree",
    href: "/",
    matchPrefixes: ["/processes"],
  },
  {
    key: "form-models",
    label: "Form Models",
    icon: "description",
    href: "/form-models",
    capability: "form-models:view",
  },
  {
    key: "review-queue",
    label: "Review Queue",
    icon: "rate_review",
    href: "/review-queue",
    capability: "review-queue:view",
  },
  {
    key: "integrations",
    label: "API & Integrations",
    icon: "integration_instructions",
    href: "/integrations",
    capability: "integrations:view",
  },
  {
    key: "users",
    label: "Users",
    icon: "group",
    href: "/admin/users",
    capability: "users:manage",
  },
  {
    key: "settings",
    label: "Settings",
    icon: "settings",
    href: null,
    disabledReason: "Settings is not implemented in this demo.",
  },
];

export const secondaryNav: NavItem[] = [
  {
    key: "docs",
    label: "Docs & Guides",
    icon: "menu_book",
    href: null,
    disabledReason: "Documentation is not implemented in this demo.",
  },
  {
    key: "support",
    label: "Support",
    icon: "support_agent",
    href: null,
    disabledReason: "Support is not implemented in this demo.",
  },
];

/** Filters nav items down to what `role` is permitted to see. */
export function navItemsForRole(items: NavItem[], role: string | null | undefined): NavItem[] {
  return items.filter((item) => !item.capability || hasCapability(role, item.capability));
}

/**
 * Maps a pathname to the capability required to view it, for routes that
 * aren't already covered by `primaryNav`'s own `capability` field (nested
 * routes such as `/processes/new` or `/processes/{id}/edit`). Returns
 * `null` when no extra capability is required beyond being signed in.
 */
export function capabilityForPath(pathname: string): Capability | null {
  if (pathname === "/processes/new" || /^\/processes\/[^/]+\/edit\/?$/.test(pathname)) {
    return "processes:write";
  }
  if (pathname === "/admin/users" || pathname.startsWith("/admin/users/")) {
    return "users:manage";
  }
  if (pathname === "/review-queue" || pathname.startsWith("/review-queue/")) {
    return "review-queue:view";
  }
  if (pathname === "/form-models" || pathname.startsWith("/form-models/")) {
    return "form-models:view";
  }
  if (pathname === "/integrations" || pathname.startsWith("/integrations/")) {
    return "integrations:view";
  }
  return null;
}

/**
 * Routes rendered without the application chrome.
 */
export const chromelessRoutes = ["/login"];

export function isChromelessRoute(pathname: string) {
  return chromelessRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isNavItemActive(item: NavItem, pathname: string) {
  if (!item.href) {
    return false;
  }

  if (item.href === "/") {
    // "Processes" owns the root listing and everything beneath /processes.
    return pathname === "/" || pathname.startsWith("/processes");
  }

  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }

  return (item.matchPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export type Crumb = { label: string; href?: string };

const staticCrumbLabels: Record<string, string> = {
  "": "Home",
  dashboard: "Dashboard",
  processes: "Processes",
  "form-models": "Form Models",
  "review-queue": "Review Queue",
  integrations: "API & Integrations",
  admin: "Admin",
  users: "Users",
  jobs: "Jobs",
  new: "New Process",
  edit: "Edit",
  login: "Sign in",
};

function humanizeSegment(segment: string) {
  const known = staticCrumbLabels[segment];
  if (known) {
    return known;
  }

  // Opaque identifiers stay recognisable but don't dominate the trail.
  if (segment.length > 12) {
    return `${segment.slice(0, 8)}…`;
  }

  return segment;
}

/**
 * Derives the breadcrumb trail from the pathname. The trail always starts at
 * the processes root, matching the design's "/"-separated breadcrumbs.
 */
export function breadcrumbsForPath(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return [{ label: "Processes" }];
  }

  const crumbs: Crumb[] = [];
  let href = "";

  segments.forEach((segment, index) => {
    href += `/${segment}`;
    const isLast = index === segments.length - 1;
    // "/admin" has no index route of its own (only "/admin/users" exists),
    // so never link to it — otherwise Next.js prefetches a 404.
    const isUnroutableAdminSegment = segment === "admin" && href === "/admin";
    crumbs.push({
      label: humanizeSegment(segment),
      // The process list lives at the root, not at /processes.
      href:
        isLast || isUnroutableAdminSegment
          ? undefined
          : href === "/processes"
            ? "/"
            : href,
    });
  });

  return crumbs;
}
