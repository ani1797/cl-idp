import type { components } from "../../../packages/shared/src/generated/api";

const DEFAULT_API_BASE_URL = "http://localhost:8000";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type ApiErrorBody = Schema<"Error">;
export type Health = Schema<"Health">;
export type AnalyzerRef = Schema<"AnalyzerRef">;
export type Analyzer = Schema<"Analyzer">;
export type BusinessProcessInput = Schema<"BusinessProcessInput">;
export type BusinessProcess = Schema<"BusinessProcess">;
export type JobsSummary = Schema<"JobsSummary">;
export type JobStatus = Job["status"];
export type JobRef = Schema<"JobRef">;
export type PageInfo = Schema<"PageInfo">;
export type ExtractedFieldType = ExtractedField["type"];
export type ExtractedField = Schema<"ExtractedField">;
export type ReviewedField = Schema<"ReviewedField">;
export type Job = Schema<"Job">;
export type ReviewJobInput = {
  fields: ReviewedField[];
};

export type JobListFilters = {
  status?: JobStatus[];
  detectedForm?: string[];
  hasViolations?: boolean;
  reviewed?: boolean;
  unclassified?: boolean;
  fileName?: string;
  submittedFrom?: string;
  submittedTo?: string;
  limit?: number;
};

export class ApiError extends Error {
  status: number;
  body?: ApiErrorBody;

  constructor(status: number, body?: ApiErrorBody, fallbackMessage?: string) {
    super(body?.message ?? fallbackMessage ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function getBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");
}

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(`${getBaseUrl()}${path}`);

  if (query) {
    for (const [key, rawValue] of Object.entries(query)) {
      if (rawValue === undefined || rawValue === null || rawValue === "") {
        continue;
      }

      if (Array.isArray(rawValue)) {
        rawValue.forEach((value) => url.searchParams.append(key, String(value)));
        continue;
      }

      url.searchParams.set(key, String(rawValue));
    }
  }

  return url;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  query?: Record<string, unknown>;
  expectedStatuses?: number[];
  responseType?: "json" | "blob" | "void";
  headers?: HeadersInit;
};

async function readErrorBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const data = (await response.json()) as Partial<ApiErrorBody>;

    if (typeof data.message === "string" && typeof data.code === "string") {
      return {
        code: data.code,
        message: data.message,
        details:
          data.details && typeof data.details === "object"
            ? (data.details as Record<string, unknown>)
            : undefined,
      } satisfies ApiErrorBody;
    }
  }

  return undefined;
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const {
    method = "GET",
    body,
    formData,
    query,
    expectedStatuses,
    responseType = "json",
    headers,
  } = options;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers: formData
      ? headers
      : {
          "Content-Type": body ? "application/json" : "application/json",
          ...headers,
        },
    body: formData ?? (body ? JSON.stringify(body) : undefined),
  });

  const allowedStatuses = expectedStatuses ?? [];
  const isExpected = response.ok || allowedStatuses.includes(response.status);

  if (!isExpected) {
    throw new ApiError(response.status, await readErrorBody(response), response.statusText);
  }

  if (responseType === "void" || response.status === 204) {
    return undefined as T;
  }

  if (responseType === "blob") {
    return (await response.blob()) as T;
  }

  return (await response.json()) as T;
}

function buildTriggerFormData(file: Blob, fileName?: string) {
  const formData = new FormData();
  const derivedFileName =
    typeof File !== "undefined" && file instanceof File
      ? file.name
      : fileName ?? "upload.bin";

  formData.append("file", file, derivedFileName);
  return formData;
}

export const api = {
  getHealth() {
    return request<Health>("/healthz", { expectedStatuses: [503] });
  },
  listProcesses() {
    return request<BusinessProcess[]>("/processes");
  },
  createProcess(input: BusinessProcessInput) {
    return request<BusinessProcess>("/processes", {
      method: "POST",
      body: input,
      expectedStatuses: [201],
    });
  },
  getProcess(processId: string) {
    return request<BusinessProcess>(`/processes/${processId}`);
  },
  updateProcess(processId: string, input: BusinessProcessInput) {
    return request<BusinessProcess>(`/processes/${processId}`, {
      method: "PUT",
      body: input,
    });
  },
  deleteProcess(processId: string) {
    return request<void>(`/processes/${processId}`, {
      method: "DELETE",
      responseType: "void",
    });
  },
  listAnalyzers() {
    return request<Analyzer[]>("/analyzers");
  },
  triggerJob(processId: string, file: Blob, fileName?: string) {
    return request<JobRef>(`/processes/${processId}/trigger`, {
      method: "POST",
      formData: buildTriggerFormData(file, fileName),
      expectedStatuses: [202],
    });
  },
  listJobs(processId: string, filters?: JobListFilters) {
    return request<Job[]>(`/processes/${processId}/jobs`, { query: filters });
  },
  getJobsSummary(processId: string, filters?: Omit<JobListFilters, "limit">) {
    return request<JobsSummary>(`/processes/${processId}/jobs/summary`, { query: filters });
  },
  getJob(processId: string, jobId: string) {
    return request<Job>(`/processes/${processId}/jobs/${jobId}`);
  },
  getJobDocument(processId: string, jobId: string) {
    return request<Blob>(`/processes/${processId}/jobs/${jobId}/document`, {
      responseType: "blob",
    });
  },
  reviewJob(processId: string, jobId: string, input: ReviewJobInput) {
    return request<Job>(`/processes/${processId}/jobs/${jobId}/review`, {
      method: "PUT",
      body: input,
    });
  },
  retryJob(processId: string, jobId: string) {
    return request<JobRef>(`/processes/${processId}/jobs/${jobId}/retry`, {
      method: "POST",
      expectedStatuses: [202],
    });
  },
};

export type ApiClient = typeof api;
