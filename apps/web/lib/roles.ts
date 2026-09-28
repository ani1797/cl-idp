/**
 * The fixed set of roles RBAC enforcement is based on, mirrored from the
 * API's `UserRole` enum (`apps/api/app/models/public.py`). `roleLabel` is
 * both the enforced role and its display label — the API rejects any other
 * value with a 400 on create/update, so the frontend treats this list as
 * closed too (no more freeform "Operations Lead"-style custom labels).
 */
export const USER_ROLES = ["IT Admin", "Reviewer", "End User"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Capabilities gate both navigation/UI visibility (here) and the
 * corresponding mutating API calls (enforced server-side — see
 * `apps/api/app/authz.py`). Read-only aggregation views that don't expose
 * data beyond what other permitted pages already show (e.g. job status) are
 * intentionally not capability-gated on the backend; the frontend still
 * hides/redirects them for role-appropriate navigation.
 */
export type Capability =
  | "processes:write"
  | "users:manage"
  | "review:act"
  | "form-models:view"
  | "review-queue:view"
  | "integrations:view";

const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<Capability>> = {
  "IT Admin": new Set<Capability>([
    "processes:write",
    "users:manage",
    "review:act",
    "form-models:view",
    "review-queue:view",
    "integrations:view",
  ]),
  Reviewer: new Set<Capability>(["review:act", "form-models:view", "review-queue:view"]),
  "End User": new Set<Capability>([]),
};

export function hasCapability(
  role: string | null | undefined,
  capability: Capability,
): boolean {
  if (!role || !isUserRole(role)) {
    return false;
  }
  return ROLE_CAPABILITIES[role].has(capability);
}
