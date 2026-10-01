import { describe, expect, it } from "vitest";

import type { Job } from "@/lib/api";
import {
  createPendingQueueItem,
  isTerminalStatus,
  mapJobToQueueUpdate,
  MAX_FILES_PER_SELECTION,
  partitionSelection,
  summarizeQueue,
  validateFile,
  type UploadQueueItem,
} from "@/lib/upload-queue";

function makeFile(name: string, { type = "application/pdf", size = 10 }: { type?: string; size?: number } = {}) {
  const file = new File([new Uint8Array(size)], name, { type });
  return file;
}

describe("validateFile", () => {
  it("accepts a well-formed PDF", () => {
    expect(validateFile(makeFile("invoice.pdf"))).toBeUndefined();
  });

  it("rejects unsupported extensions/mime types", () => {
    expect(validateFile(makeFile("invoice.docx", { type: "application/msword" }))).toBe(
      "Only PDF, PNG, JPG, or TIFF files are supported.",
    );
  });

  it("rejects oversized files", () => {
    expect(validateFile(makeFile("big.pdf", { size: 21 * 1024 * 1024 }))).toBe(
      "Files must be 20 MB or smaller.",
    );
  });
});

describe("partitionSelection", () => {
  it("separates valid and invalid files without throwing", () => {
    const good = makeFile("good.pdf");
    const bad = makeFile("bad.docx", { type: "application/msword" });

    const result = partitionSelection([good, bad]);

    expect(result.accepted).toEqual([good]);
    expect(result.rejected).toEqual([{ file: bad, reason: "Only PDF, PNG, JPG, or TIFF files are supported." }]);
    expect(result.overflowCount).toBe(0);
  });

  it("caps the selection at maxFiles and reports overflow", () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`file-${i}.pdf`));

    const result = partitionSelection(files, { maxFiles: 3 });

    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
    expect(result.overflowCount).toBe(2);
  });

  it("defaults to MAX_FILES_PER_SELECTION", () => {
    const files = Array.from({ length: MAX_FILES_PER_SELECTION + 10 }, (_, i) => makeFile(`file-${i}.pdf`));

    const result = partitionSelection(files);

    expect(result.accepted).toHaveLength(MAX_FILES_PER_SELECTION);
    expect(result.overflowCount).toBe(10);
  });

  it("returns empty results for a null/empty selection", () => {
    expect(partitionSelection(null)).toEqual({ accepted: [], rejected: [], overflowCount: 0 });
    expect(partitionSelection([])).toEqual({ accepted: [], rejected: [], overflowCount: 0 });
  });
});

describe("isTerminalStatus", () => {
  it("treats succeeded/unclassified/failed/rejected as terminal", () => {
    expect(isTerminalStatus("succeeded")).toBe(true);
    expect(isTerminalStatus("unclassified")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
  });

  it("treats pending/uploading/queued/running as non-terminal", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("uploading")).toBe(false);
    expect(isTerminalStatus("queued")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });
});

describe("summarizeQueue", () => {
  function item(status: UploadQueueItem["status"]): UploadQueueItem {
    return { ...createPendingQueueItem(makeFile("x.pdf")), status };
  }

  it("buckets items by status", () => {
    const items = [
      item("succeeded"),
      item("unclassified"),
      item("failed"),
      item("rejected"),
      item("pending"),
      item("uploading"),
      item("queued"),
      item("running"),
    ];

    expect(summarizeQueue(items)).toEqual({
      total: 8,
      completed: 2,
      failed: 2,
      inProgress: 3,
      pending: 1,
    });
  });

  it("returns zeros for an empty queue", () => {
    expect(summarizeQueue([])).toEqual({ total: 0, completed: 0, failed: 0, inProgress: 0, pending: 0 });
  });
});

describe("mapJobToQueueUpdate", () => {
  const baseJob: Job = {
    id: "job-1",
    processId: "process-1",
    fileName: "invoice.pdf",
    status: "queued",
    submittedAt: "2026-01-01T00:00:00Z",
  };

  it("maps a succeeded classified job", () => {
    const update = mapJobToQueueUpdate({
      ...baseJob,
      status: "succeeded",
      unclassified: false,
      detectedFormName: "Invoice",
      confidenceViolations: [],
    });

    expect(update).toEqual({
      status: "succeeded",
      detectedFormName: "Invoice",
      needsReview: false,
      error: null,
    });
  });

  it("maps a succeeded job needing review", () => {
    const update = mapJobToQueueUpdate({
      ...baseJob,
      status: "succeeded",
      unclassified: false,
      detectedFormName: "Invoice",
      confidenceViolations: ["/total"],
    });

    expect(update.needsReview).toBe(true);
  });

  it("maps an unclassified job", () => {
    const update = mapJobToQueueUpdate({
      ...baseJob,
      status: "succeeded",
      unclassified: true,
    });

    expect(update.status).toBe("unclassified");
  });

  it("maps a failed job with a fallback error message", () => {
    const update = mapJobToQueueUpdate({ ...baseJob, status: "failed", error: null });
    expect(update).toEqual({ status: "failed", error: 'Processing failed for "invoice.pdf".' });
  });

  it("maps running and queued jobs", () => {
    expect(mapJobToQueueUpdate({ ...baseJob, status: "running" })).toEqual({ status: "running" });
    expect(mapJobToQueueUpdate({ ...baseJob, status: "queued" })).toEqual({ status: "queued" });
  });
});
