import type { ApiToken, BusinessProcess } from "@/lib/api";

export type AuthMode = "session-cookie" | "user-token" | "service-token";
export type EndpointId =
  | "auth-token"
  | "trigger-job"
  | "list-jobs"
  | "jobs-summary"
  | "get-job"
  | "retry-job";
export type SnippetLanguage = "curl" | "typescript" | "python";
export type GeneratedUserToken = ApiToken & {
  issuedAt: number;
  email: string;
};

export type EndpointRequestField = {
  location: "Path" | "Query" | "Body" | "Form";
  name: string;
  required: boolean;
  description: string;
};

export type EndpointDefinition = {
  id: EndpointId;
  method: "GET" | "POST";
  title: string;
  pathTemplate: string;
  purpose: string;
  responseStatus: "200 OK" | "202 Accepted";
  requestDetails: EndpointRequestField[];
  integrationNotes: string[];
  supportsTimeline: boolean;
  supportsFileUpload: boolean;
  noAuthRequired?: boolean;
};

export const DOCUMENTED_ENDPOINT_COUNT = 6;
export const SAMPLE_FILE_NAME = "claim-form.pdf";
export const SAMPLE_JOB_ID = "46f4df34-372e-4fbb-a89a-e047f1e53b2a";
export const SAMPLE_RETRY_JOB_ID = "80a7c5ca-3ef8-4342-a7a8-46eca7648f16";
export const API_BASE_PATH = "/api";

export const TIMELINE_STAGES = ["queued", "processing", "extracting", "completed"] as const;
export type TimelineStage = (typeof TIMELINE_STAGES)[number];

export function processApiBasePath(processId: string) {
  return `${API_BASE_PATH}/processes/${processId}`;
}

export function pathWithConcreteValues(process: BusinessProcess, endpointId: EndpointId) {
  const basePath = processApiBasePath(process.id);

  switch (endpointId) {
    case "auth-token":
      return `${API_BASE_PATH}/auth/token`;
    case "trigger-job":
      return `${basePath}/trigger`;
    case "list-jobs":
      return `${basePath}/jobs`;
    case "jobs-summary":
      return `${basePath}/jobs/summary`;
    case "get-job":
      return `${basePath}/jobs/${SAMPLE_JOB_ID}`;
    case "retry-job":
      return `${basePath}/jobs/${SAMPLE_JOB_ID}/retry`;
  }
}

export const ENDPOINT_CATALOG: EndpointDefinition[] = [
  {
    id: "auth-token",
    method: "POST",
    title: "Mint a user bearer token",
    pathTemplate: "/auth/token",
    purpose: "Exchange an email and password for a short-lived bearer token used in scripts and ad-hoc testing.",
    responseStatus: "200 OK",
    supportsTimeline: false,
    supportsFileUpload: false,
    noAuthRequired: true,
    requestDetails: [
      {
        location: "Body",
        name: "email",
        required: true,
        description: "User email address. The backend validates the matching active account.",
      },
      {
        location: "Body",
        name: "password",
        required: true,
        description: "User password. Invalid credentials return 401 unauthorized.",
      },
    ],
    integrationNotes: [
      "Public auth route — no session cookie or bearer token is required to call it.",
      "Returns a short-lived token carrying the caller's own role; it never escalates RBAC.",
      "The browser session cookie from POST /auth/login is intentionally kept separate from this API token.",
    ],
  },
  {
    id: "trigger-job",
    method: "POST",
    title: "Trigger a pipeline run",
    pathTemplate: "/processes/{processId}/trigger",
    purpose: "Upload one document as multipart/form-data and enqueue an extraction job for the selected process.",
    responseStatus: "202 Accepted",
    supportsTimeline: true,
    supportsFileUpload: true,
    requestDetails: [
      {
        location: "Path",
        name: "processId",
        required: true,
        description: "Business process ID returned by GET /processes.",
      },
      {
        location: "Form",
        name: "file",
        required: true,
        description: "Exactly one PDF, PNG, JPG, or TIFF document, up to 20 MB and 20 pages.",
      },
    ],
    integrationNotes: [
      "Returns 409 while the routing analyzer is still building or has failed.",
      "Exactly one file is accepted; unsupported MIME types, unreadable documents, oversize uploads, or too many pages return 400.",
      "The accepted response only contains a jobId. Poll the job resource to watch progress and retrieve results.",
    ],
  },
  {
    id: "list-jobs",
    method: "GET",
    title: "List jobs for a process",
    pathTemplate: "/processes/{processId}/jobs",
    purpose: "Fetch recent job history for one process with optional status, review, and date filters.",
    responseStatus: "200 OK",
    supportsTimeline: true,
    supportsFileUpload: false,
    requestDetails: [
      {
        location: "Path",
        name: "processId",
        required: true,
        description: "Business process ID returned by GET /processes.",
      },
      {
        location: "Query",
        name: "status, detectedForm, hasViolations, reviewed, unclassified, fileName, submittedFrom, submittedTo, limit",
        required: false,
        description: "Optional AND-combined filters; limit defaults to 100 and tops out at 500.",
      },
    ],
    integrationNotes: [
      "Sorted newest-first by submittedAt.",
      "The fields array is omitted from list items for payload size — use GET /jobs/{jobId} for extracted fields.",
      "Use the summary endpoint for uncapped counts over the same filter set.",
    ],
  },
  {
    id: "jobs-summary",
    method: "GET",
    title: "Read aggregate job counts",
    pathTemplate: "/processes/{processId}/jobs/summary",
    purpose: "Return total, needs-review, failed, and unclassified counts across all jobs matching the filters.",
    responseStatus: "200 OK",
    supportsTimeline: true,
    supportsFileUpload: false,
    requestDetails: [
      {
        location: "Path",
        name: "processId",
        required: true,
        description: "Business process ID returned by GET /processes.",
      },
      {
        location: "Query",
        name: "status, detectedForm, hasViolations, reviewed, unclassified, fileName, submittedFrom, submittedTo",
        required: false,
        description: "Same filters as GET /jobs, except limit is not supported because counts are uncapped.",
      },
    ],
    integrationNotes: [
      "Counts every matching job, even when the jobs list itself would hit a limit cap.",
      "totalEstimatedCostUsd is an estimate derived from document page counts, not an Azure billing export.",
      "The route must stay registered before /jobs/{jobId}; summary is a reserved path, never a job ID.",
    ],
  },
  {
    id: "get-job",
    method: "GET",
    title: "Poll a single job",
    pathTemplate: "/processes/{processId}/jobs/{jobId}",
    purpose: "Read one job's current status and, once complete, its extracted fields, confidence data, and review markers.",
    responseStatus: "200 OK",
    supportsTimeline: true,
    supportsFileUpload: false,
    requestDetails: [
      {
        location: "Path",
        name: "processId",
        required: true,
        description: "Business process ID that owns the job.",
      },
      {
        location: "Path",
        name: "jobId",
        required: true,
        description: "Job ID from the trigger or retry response.",
      },
    ],
    integrationNotes: [
      "Poll until status is succeeded or failed.",
      "pages and fields are returned on job detail; they are intentionally omitted from listJobs payloads.",
      "Use a 2–3 second polling cadence to avoid hammering the queue while still feeling responsive.",
    ],
  },
  {
    id: "retry-job",
    method: "POST",
    title: "Re-run a failed job",
    pathTemplate: "/processes/{processId}/jobs/{jobId}/retry",
    purpose: "Queue a new job over the already-uploaded source document while leaving the original failed run intact.",
    responseStatus: "202 Accepted",
    supportsTimeline: true,
    supportsFileUpload: false,
    requestDetails: [
      {
        location: "Path",
        name: "processId",
        required: true,
        description: "Business process ID that owns the failed job.",
      },
      {
        location: "Path",
        name: "jobId",
        required: true,
        description: "Failed job ID to retry. Non-failed jobs return 409.",
      },
    ],
    integrationNotes: [
      "Requires IT Admin or Reviewer for user-bound callers; trusted service-token automation is also allowed.",
      "Returns 409 when the process routing analyzer is not ready or the chosen job is not failed.",
      "The new job's retryOfJobId points back to the original failed job for auditability.",
    ],
  },
] as const;

export const FLOW_STEPS = [
  {
    step: 1,
    title: "Get a token",
    description: "Mint a user bearer token for scripts, or use the service token your IT Admin configured.",
    method: "POST",
    path: "/auth/token",
    icon: "key",
  },
  {
    step: 2,
    title: "Send the document",
    description: "Upload one file with multipart/form-data and receive a jobId immediately.",
    method: "POST",
    path: "/processes/{processId}/trigger",
    icon: "upload",
  },
  {
    step: 3,
    title: "Poll for results",
    description: "Poll every 2–3 seconds until the job leaves queued or running.",
    method: "GET",
    path: "/processes/{processId}/jobs/{jobId}",
    icon: "sync",
  },
  {
    step: 4,
    title: "Read or retry",
    description: "Read extracted fields and confidence scores, or re-queue a failed job.",
    method: "POST",
    path: "/processes/{processId}/jobs/{jobId}/retry",
    icon: "task_alt",
  },
] as const;

function buildSampleFields(includeReview = true) {
  return [
    {
      name: "claimNumber",
      path: "/claimNumber",
      type: "string",
      value: "CLM-10428",
      confidence: 0.99,
      boundingBox: [0.11, 0.14, 0.32, 0.14, 0.32, 0.18, 0.11, 0.18],
      page: 1,
    },
    {
      name: "memberId",
      path: "/memberId",
      type: "string",
      value: "A4472106",
      confidence: 0.74,
      reviewedValue: includeReview ? "A4472106" : undefined,
      boundingBox: [0.11, 0.21, 0.28, 0.21, 0.28, 0.25, 0.11, 0.25],
      page: 1,
    },
    {
      name: "provider",
      path: "/provider",
      type: "object",
      properties: {
        name: {
          name: "name",
          path: "/provider/name",
          type: "string",
          value: "Northgate Clinic",
          confidence: 0.96,
          boundingBox: [0.11, 0.29, 0.39, 0.29, 0.39, 0.33, 0.11, 0.33],
          page: 1,
        },
        totalAmount: {
          name: "totalAmount",
          path: "/provider/totalAmount",
          type: "number",
          value: 482.13,
          confidence: 0.93,
          boundingBox: [0.67, 0.78, 0.82, 0.78, 0.82, 0.82, 0.67, 0.82],
          page: 1,
        },
      },
    },
  ];
}

function timelineToJobStatus(stage: TimelineStage) {
  switch (stage) {
    case "queued":
      return "queued";
    case "processing":
    case "extracting":
      return "running";
    case "completed":
      return "succeeded";
  }
}

export function buildSampleResponse(args: {
  endpointId: EndpointId;
  process: BusinessProcess;
  generatedToken: GeneratedUserToken | null;
  timelineStage: TimelineStage;
}) {
  const { endpointId, process, generatedToken, timelineStage } = args;
  const runningStatus = timelineToJobStatus(timelineStage);

  switch (endpointId) {
    case "auth-token":
      return {
        accessToken:
          generatedToken?.accessToken ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sample-user-token",
        tokenType: generatedToken?.tokenType ?? "Bearer",
        expiresIn: generatedToken?.expiresIn ?? 3600,
      };
    case "trigger-job":
      return {
        jobId: SAMPLE_JOB_ID,
      };
    case "list-jobs":
      return [
        {
          id: SAMPLE_JOB_ID,
          processId: process.id,
          fileName: SAMPLE_FILE_NAME,
          status: runningStatus,
          submittedAt: "2026-09-28T16:50:12Z",
          completedAt: runningStatus === "succeeded" ? "2026-09-28T16:51:01Z" : null,
          detectedForm: runningStatus === "succeeded" ? process.allowedAnalyzers[0]?.id ?? null : null,
          detectedFormName: runningStatus === "succeeded" ? process.allowedAnalyzers[0]?.name ?? null : null,
          unclassified: false,
          retryOfJobId: null,
          fieldCount: runningStatus === "succeeded" ? 4 : null,
          averageConfidence: runningStatus === "succeeded" ? 0.91 : null,
          confidenceViolations: runningStatus === "succeeded" ? ["/memberId"] : [],
          estimatedCostUsd: runningStatus === "queued" ? 0 : 0.08,
          error: null,
          reviewedAt: null,
        },
        {
          id: "c0dcc709-c55e-422c-ae7e-f1ca13d839df",
          processId: process.id,
          fileName: "claim-followup.pdf",
          status: "failed",
          submittedAt: "2026-09-27T14:25:41Z",
          completedAt: "2026-09-27T14:26:25Z",
          detectedForm: null,
          detectedFormName: null,
          unclassified: null,
          retryOfJobId: null,
          fieldCount: null,
          averageConfidence: null,
          confidenceViolations: null,
          estimatedCostUsd: 0.08,
          error: "Processing timed out while waiting for the analyzer response.",
          reviewedAt: null,
        },
      ];
    case "jobs-summary":
      return {
        total: 48,
        needsReview: 7,
        failed: 3,
        unclassified: 2,
        totalEstimatedCostUsd: 3.84,
      };
    case "get-job":
      return {
        id: SAMPLE_JOB_ID,
        processId: process.id,
        fileName: SAMPLE_FILE_NAME,
        status: runningStatus,
        submittedAt: "2026-09-28T16:50:12Z",
        completedAt: runningStatus === "succeeded" ? "2026-09-28T16:51:01Z" : null,
        detectedForm: runningStatus === "succeeded" ? process.allowedAnalyzers[0]?.id ?? null : null,
        detectedFormName: runningStatus === "succeeded" ? process.allowedAnalyzers[0]?.name ?? null : null,
        unclassified: false,
        retryOfJobId: null,
        pages:
          runningStatus === "succeeded"
            ? [{ page: 1, width: 8.5, height: 11, unit: "inch", angle: 0 }]
            : null,
        fields: runningStatus === "succeeded" ? buildSampleFields(false) : null,
        fieldCount: runningStatus === "succeeded" ? 4 : null,
        averageConfidence: runningStatus === "succeeded" ? 0.91 : null,
        confidenceViolations: runningStatus === "succeeded" ? ["/memberId"] : [],
        estimatedCostUsd: runningStatus === "queued" ? 0 : 0.08,
        error: null,
        reviewedAt: null,
      };
    case "retry-job":
      return {
        jobId: SAMPLE_RETRY_JOB_ID,
      };
  }
}

export function getEndpointDefinition(endpointId: EndpointId) {
  const endpoint = ENDPOINT_CATALOG.find((item) => item.id === endpointId);
  if (!endpoint) {
    throw new Error(`Unknown endpoint: ${endpointId}`);
  }
  return endpoint;
}
