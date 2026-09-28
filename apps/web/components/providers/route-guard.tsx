"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/components/providers/session-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { capabilityForPath, isChromelessRoute } from "@/lib/navigation";
import { hasCapability } from "@/lib/roles";

/**
 * Client-side guard. The API is the real enforcement point for mutating
 * actions — this keeps signed-out users from staring at an empty shell, and
 * redirects signed-in users away from pages their role can't act on so they
 * aren't shown a page that immediately 403s.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { user, isResolved } = useSession();

  const isPublic = isChromelessRoute(pathname);
  const shouldRedirectToLogin = isResolved && !user && !isPublic;

  const requiredCapability = capabilityForPath(pathname);
  const isForbidden =
    isResolved &&
    Boolean(user) &&
    requiredCapability !== null &&
    !hasCapability(user?.roleLabel, requiredCapability);

  useEffect(() => {
    if (shouldRedirectToLogin) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
      return;
    }
    if (isForbidden) {
      router.replace("/");
    }
  }, [shouldRedirectToLogin, isForbidden, pathname, router]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (!isResolved || shouldRedirectToLogin || isForbidden) {
    return (
      <div className="flex min-h-screen flex-col gap-4 p-margin" aria-busy="true">
        <span className="sr-only">Checking your session…</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}
