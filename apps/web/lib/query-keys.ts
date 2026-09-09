export const queryKeys = {
  analyzers: ["analyzers"] as const,
  processes: {
    all: ["processes"] as const,
    detail: (processId: string) => ["processes", processId] as const,
  },
  jobs: {
    all: (processId: string) => ["processes", processId, "jobs"] as const,
    detail: (processId: string, jobId: string) => ["processes", processId, "jobs", jobId] as const,
  },
} as const;
