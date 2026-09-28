"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";

import { ApiError, api, type AuthUser } from "@/lib/api";

type SessionValue = {
  user: AuthUser | null;
  isLoading: boolean;
  /** True once the session has been resolved one way or the other. */
  isResolved: boolean;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export const sessionQueryKey = ["session", "me"] as const;

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetched } = useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        return await api.getCurrentUser();
      } catch (error) {
        // An unauthenticated visitor is a normal state, not a failure.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      queryClient.setQueryData(sessionQueryKey, null);
      await queryClient.invalidateQueries();
    }
  }, [queryClient]);

  const value = useMemo<SessionValue>(
    () => ({
      user: data ?? null,
      isLoading,
      isResolved: isFetched,
      refresh,
      signOut,
    }),
    [data, isLoading, isFetched, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }

  return context;
}
