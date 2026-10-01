import type { Job } from "@/lib/api";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_SELECTION = 100;
export const UPLOAD_CONCURRENCY = 5;

export const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"];
export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/x-tiff",
] as const;
export const FILE_INPUT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.tif,.tiff";

/**
 * Lifecycle of a single queued upload. `pending` -> `uploading` ->
 * `queued` (202 accepted) -> `running` -> a terminal state
 * (`succeeded` / `unclassified` / `failed`), or `rejected` if the file
 * never left the browser (client-side validation failure).
 */
export type UploadQueueItemStatus =
  | "pending"
  | "uploading"
  | "queued"
  | "running"
  | "succeeded"
  | "unclassified"
  | "failed"
  | "rejected";

export const TERMINAL_STATUSES: ReadonlySet<UploadQueueItemStatus> = new Set([
  "succeeded",
  "unclassified",
  "failed",
  "rejected",
]);

export function isTerminalStatus(status: UploadQueueItemStatus) {
  return TERMINAL_STATUSES.has(status);
}

export type UploadQueueItem = {
  id: string;
  file: File | null;
  fileName: string;
  sizeBytes: number;
  status: UploadQueueItemStatus;
  jobId: string | null;
  error: string | null;
  detectedFormName: string | null;
  needsReview: boolean;
  startedAt: string | null;
};

export function createQueueItemId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPendingQueueItem(file: File): UploadQueueItem {
  return {
    id: createQueueItemId(),
    file,
    fileName: file.name,
    sizeBytes: file.size,
    status: "pending",
    jobId: null,
    error: null,
    detectedFormName: null,
    needsReview: false,
    startedAt: null,
  };
}

/**
 * Validates a single file against the same rules the backend enforces
 * synchronously (`apps/api/app/routers/trigger.py`): extension + MIME
 * type, and the 20 MB size cap. Page-count checks still only happen
 * server-side.
 */
export function validateFile(file: File): string | undefined {
  const normalizedName = file.name.toLowerCase();
  const hasValidExtension = ACCEPTED_EXTENSIONS.some((extension) => normalizedName.endsWith(extension));
  const hasValidMimeType =
    file.type.length === 0 ||
    ACCEPTED_MIME_TYPES.includes(file.type.toLowerCase() as (typeof ACCEPTED_MIME_TYPES)[number]);

  if (!hasValidExtension || !hasValidMimeType) {
    return "Only PDF, PNG, JPG, or TIFF files are supported.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return "Files must be 20 MB or smaller.";
  }

  return undefined;
}

export type PartitionedSelection = {
  accepted: File[];
  rejected: Array<{ file: File; reason: string }>;
  overflowCount: number;
};

/**
 * Splits a raw file selection into files that should be queued and files
 * that should be reported as rejected, without ever throwing — a bad
 * selection should never prevent the valid files in it from being
 * queued. Files beyond `maxFiles` are dropped silently from both buckets
 * and surfaced only via `overflowCount`, so the queue list doesn't balloon
 * with hundreds of "too many files" rows.
 */
export function partitionSelection(
  files: FileList | File[] | null,
  { maxFiles = MAX_FILES_PER_SELECTION }: { maxFiles?: number } = {},
): PartitionedSelection {
  const allFiles = files ? Array.from(files) : [];
  const withinLimit = maxFiles > 0 ? allFiles.slice(0, maxFiles) : allFiles;
  const overflowCount = allFiles.length - withinLimit.length;

  const accepted: File[] = [];
  const rejected: Array<{ file: File; reason: string }> = [];

  for (const file of withinLimit) {
    const reason = validateFile(file);
    if (reason) {
      rejected.push({ file, reason });
    } else {
      accepted.push(file);
    }
  }

  return { accepted, rejected, overflowCount };
}

export type QueueSummary = {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  pending: number;
};

export function summarizeQueue(items: UploadQueueItem[]): QueueSummary {
  let completed = 0;
  let failed = 0;
  let inProgress = 0;
  let pending = 0;

  for (const item of items) {
    switch (item.status) {
      case "succeeded":
      case "unclassified":
        completed += 1;
        break;
      case "failed":
      case "rejected":
        failed += 1;
        break;
      case "pending":
        pending += 1;
        break;
      case "uploading":
      case "queued":
      case "running":
        inProgress += 1;
        break;
      default:
        break;
    }
  }

  return { total: items.length, completed, failed, inProgress, pending };
}

/**
 * Maps a server `Job` (from a `listJobs` reconciliation poll) onto the
 * fields of a queue item that should be updated. Returns `null` when the
 * job carries no information relevant to the queue (never expected in
 * practice, kept defensive).
 */
export function mapJobToQueueUpdate(job: Job): Partial<UploadQueueItem> {
  if (job.status === "succeeded") {
    return {
      status: job.unclassified ? "unclassified" : "succeeded",
      detectedFormName: job.detectedFormName ?? null,
      needsReview: (job.confidenceViolations?.length ?? 0) > 0,
      error: null,
    };
  }

  if (job.status === "failed") {
    return {
      status: "failed",
      error: job.error ?? `Processing failed for "${job.fileName}".`,
    };
  }

  if (job.status === "running") {
    return { status: "running" };
  }

  return { status: "queued" };
}
