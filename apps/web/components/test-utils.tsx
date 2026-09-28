import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement, type ReactNode } from "react";

import { SessionProvider, sessionQueryKey } from "@/components/providers/session-provider";
import { type AuthUser } from "@/lib/api";
import { createAppQueryClient } from "@/lib/query";

export function renderWithQueryClient(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const queryClient = createAppQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(ui, {
    wrapper: Wrapper,
    ...options,
  });
}

export const testUser: AuthUser = {
  id: "user-1",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  roleLabel: "IT Admin",
  isActive: true,
};

/**
 * Renders with the session already resolved so components that read
 * `useSession()` do not have to wait on a network round trip.
 */
export function renderWithSession(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { user?: AuthUser | null },
) {
  const { user = testUser, ...renderOptions } = options ?? {};
  const queryClient = createAppQueryClient();
  queryClient.setQueryData(sessionQueryKey, user);

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );

  return render(ui, {
    wrapper: Wrapper,
    ...renderOptions,
  });
}
