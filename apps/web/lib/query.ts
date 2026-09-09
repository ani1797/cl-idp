import { QueryClient } from "@tanstack/react-query";

export const pollingIntervals = {
  jobs: {
    fastMs: 2_000,
    slowMs: 10_000,
  },
  analyzers: {
    fastMs: 5_000,
    slowMs: 10_000,
  },
  backoffAfterMs: 60_000,
  timeoutMs: 10 * 60 * 1_000,
} as const;

export function getPollingInterval({
  startedAt,
  fastMs,
  slowMs,
}: {
  startedAt?: Date | string | null;
  fastMs: number;
  slowMs: number;
}) {
  if (!startedAt) {
    return fastMs;
  }

  const started = new Date(startedAt).getTime();

  if (Number.isNaN(started)) {
    return fastMs;
  }

  const elapsed = Date.now() - started;

  if (elapsed >= pollingIntervals.timeoutMs) {
    return false;
  }

  return elapsed >= pollingIntervals.backoffAfterMs ? slowMs : fastMs;
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2_000,
        gcTime: 10 * 60 * 1_000,
        refetchOnWindowFocus: false,
        retry(failureCount, error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof error.status === "number" &&
            error.status < 500 &&
            error.status !== 408 &&
            error.status !== 429
          ) {
            return false;
          }

          return failureCount < 3;
        },
        retryDelay(attemptIndex) {
          return Math.min(1_000 * 2 ** attemptIndex, 10_000);
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
