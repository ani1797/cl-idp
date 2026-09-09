"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  RefreshCcw,
} from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { ErrorCard } from "@/components/error-card";
import {
  AverageConfidenceValue,
  EstimatedCostValue,
  JobStatusBadge,
  ReviewedIndicator,
} from "@/components/job-history-ui";
import { PageLoadingState } from "@/components/page-loading-state";
import { Button } from "@/components/ui/button";
import {
  api,
  type ExtractedField,
  type Job,
  type PageInfo,
  type ReviewedField,
} from "@/lib/api";
import { getErrorMessage, showErrorToast } from "@/lib/errors";
import {
  buildReviewPayload,
  collectLeafFields,
  getDocumentKind,
  getFieldChildren,
  getFieldLabel,
  getInitialFieldValue,
  getOverlayBounds,
  getReturnHref,
  isLeafField,
  isJobInFlight,
  scaleBoundingBoxPoints,
  type LeafField,
} from "@/lib/inference-review";
import { getPollingInterval, pollingIntervals } from "@/lib/query";
import { queryKeys } from "@/lib/query-keys";
import { useObjectUrl } from "@/lib/use-object-url";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

type RenderedPageSize = {
  width: number;
  height: number;
};

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (confidence === undefined || confidence === null) {
    return (
      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
        n/a
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
      {(confidence * 100).toFixed(0)}%
    </span>
  );
}

function FieldTypeBadge({ type }: { type: ExtractedField["type"] }) {
  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-background px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
      {type}
    </span>
  );
}

function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;

    if (!node) {
      return;
    }

    const updateWidth = () => {
      setWidth(node.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function formatDetectedForm(job: Job) {
  if (job.unclassified) {
    return "No matching form";
  }

  return job.detectedFormName || job.detectedForm || "—";
}

function buildReviewHref(processId: string, jobId: string, from: string | null) {
  const pathname = `/processes/${processId}/jobs/${jobId}`;

  if (!from) {
    return pathname;
  }

  return `${pathname}?from=${encodeURIComponent(from)}`;
}

function DocumentEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[28rem] items-center justify-center rounded-2xl border border-dashed bg-muted/10 p-8 text-center">
      <div className="max-w-md space-y-3">
        <FileSearch className="mx-auto size-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function DocumentToolbar({
  fileName,
  currentPage,
  totalPages,
  onPreviousPage,
  onNextPage,
  canPage,
}: {
  fileName: string;
  currentPage: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  canPage: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Source document
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{fileName}</h2>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPreviousPage}
          disabled={!canPage || currentPage <= 1}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <span className="min-w-24 text-center text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onNextPage}
          disabled={!canPage || currentPage >= totalPages}
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function BoundingBoxOverlay({
  fields,
  page,
  renderedSize,
  focusedPath,
  onSelectPath,
}: {
  fields: LeafField[];
  page: PageInfo | undefined;
  renderedSize: RenderedPageSize | null;
  focusedPath: string | null;
  onSelectPath: (path: string) => void;
}) {
  if (!renderedSize || fields.length === 0) {
    return null;
  }

  const rotation = page?.angle ?? 0;
  const centerX = renderedSize.width / 2;
  const centerY = renderedSize.height / 2;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10"
      width={renderedSize.width}
      height={renderedSize.height}
      viewBox={`0 0 ${renderedSize.width} ${renderedSize.height}`}
    >
      <g transform={rotation ? `rotate(${rotation} ${centerX} ${centerY})` : undefined}>
        {fields.map((field) => {
          const points = scaleBoundingBoxPoints(
            field.boundingBox,
            renderedSize.width,
            renderedSize.height,
          );
          const bounds = getOverlayBounds(points);

          if (!bounds || points.length === 0) {
            return null;
          }

          const active = field.path === focusedPath;

          return (
            <g key={field.path}>
              <polygon
                points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                className={cn(
                  "pointer-events-auto cursor-pointer transition-colors",
                  active ? "fill-amber-300/30 stroke-amber-500" : "fill-sky-300/15 stroke-sky-500/80",
                )}
                strokeWidth={active ? 3 : 2}
                onClick={() => onSelectPath(field.path)}
              />
              <rect
                className={cn(
                  "pointer-events-none fill-none",
                  active ? "stroke-amber-500/60" : "stroke-sky-500/30",
                )}
                x={bounds.left}
                y={bounds.top}
                width={bounds.width}
                height={bounds.height}
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function PdfDocumentViewer({
  blob,
  documentIdentity,
  fileName,
  currentPage,
  onCurrentPageChange,
  overlays,
  focusedPath,
  onSelectPath,
  pages,
}: {
  blob: Blob;
  documentIdentity: string;
  fileName: string;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
  overlays: LeafField[];
  focusedPath: string | null;
  onSelectPath: (path: string) => void;
  pages: PageInfo[] | undefined;
}) {
  const [pageCount, setPageCount] = useState(1);
  const [renderedSize, setRenderedSize] = useState<RenderedPageSize | null>(null);
  const objectUrl = useObjectUrl(blob, documentIdentity);
  const pageFrameRef = useRef<HTMLDivElement | null>(null);
  const pageWidth = useElementWidth(pageFrameRef);

  useEffect(() => {
    if (currentPage > pageCount) {
      onCurrentPageChange(pageCount);
    }
  }, [currentPage, onCurrentPageChange, pageCount]);

  function syncRenderedSize() {
    const surface = pageFrameRef.current?.querySelector("canvas, img");

    if (!(surface instanceof HTMLElement)) {
      return;
    }

    setRenderedSize({
      width: surface.clientWidth,
      height: surface.clientHeight,
    });
  }

  if (!objectUrl) {
    return (
      <DocumentEmptyState
        title="Preparing document"
        description="The uploaded document is loading into the PDF viewer."
      />
    );
  }

  return (
    <div className="space-y-4">
      <DocumentToolbar
        fileName={fileName}
        currentPage={currentPage}
        totalPages={pageCount}
        onPreviousPage={() => onCurrentPageChange(Math.max(1, currentPage - 1))}
        onNextPage={() => onCurrentPageChange(Math.min(pageCount, currentPage + 1))}
        canPage={pageCount > 1}
      />
      <div className="overflow-auto rounded-2xl bg-muted/20 p-4">
        <div ref={pageFrameRef} className="relative mx-auto w-full max-w-full">
          <Document
            file={objectUrl}
            onLoadSuccess={({ numPages }) => {
              setPageCount(numPages);
            }}
            loading={<DocumentEmptyState title="Loading document" description="Rendering the PDF preview for review." />}
            error={<DocumentEmptyState title="Could not render document" description="The PDF viewer could not load this file. Try refreshing the page." />}
          >
            <Page
              pageNumber={currentPage}
              width={pageWidth > 0 ? pageWidth : 720}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              onRenderSuccess={syncRenderedSize}
            />
          </Document>
          <BoundingBoxOverlay
            fields={overlays}
            page={pages?.[currentPage - 1]}
            renderedSize={renderedSize}
            focusedPath={focusedPath}
            onSelectPath={onSelectPath}
          />
        </div>
      </div>
    </div>
  );
}

function ImageDocumentViewer({
  blob,
  documentIdentity,
  fileName,
  overlays,
  focusedPath,
  onSelectPath,
  page,
}: {
  blob: Blob;
  documentIdentity: string;
  fileName: string;
  overlays: LeafField[];
  focusedPath: string | null;
  onSelectPath: (path: string) => void;
  page: PageInfo | undefined;
}) {
  const objectUrl = useObjectUrl(blob, documentIdentity);
  const [renderedSize, setRenderedSize] = useState<RenderedPageSize | null>(null);

  if (!objectUrl) {
    return (
      <DocumentEmptyState
        title="Preparing document"
        description="The uploaded image is loading into the review pane."
      />
    );
  }

  return (
    <div className="space-y-4">
      <DocumentToolbar
        fileName={fileName}
        currentPage={1}
        totalPages={1}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
        canPage={false}
      />
      <div className="overflow-auto rounded-2xl bg-muted/20 p-4">
        <div className="relative mx-auto inline-block max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob URL preview */}
          <img
            src={objectUrl}
            alt={fileName}
            className="block max-w-full rounded-xl shadow-sm"
            onLoad={(event) => {
              setRenderedSize({
                width: event.currentTarget.clientWidth,
                height: event.currentTarget.clientHeight,
              });
            }}
          />
          <BoundingBoxOverlay
            fields={overlays}
            page={page}
            renderedSize={renderedSize}
            focusedPath={focusedPath}
            onSelectPath={onSelectPath}
          />
        </div>
      </div>
    </div>
  );
}

function FieldTree({
  field,
  level,
  values,
  approvals,
  confidenceViolations,
  focusedPath,
  onSelectField,
  onValueChange,
  onApprove,
}: {
  field: ExtractedField;
  level: number;
  values: Map<string, string>;
  approvals: Set<string>;
  confidenceViolations: Set<string>;
  focusedPath: string | null;
  onSelectField: (field: LeafField) => void;
  onValueChange: (field: LeafField, value: string) => void;
  onApprove: (field: LeafField) => void;
}) {
  const label = getFieldLabel(field);

  if (isLeafField(field)) {
    const value = values.get(field.path) ?? "";
    const approved = approvals.has(field.path);
    const violation = confidenceViolations.has(field.path) && !approved;

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectField(field)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectField(field);
          }
        }}
        className={cn(
          "w-full rounded-2xl border p-4 text-left transition hover:border-sky-200 hover:bg-sky-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          focusedPath === field.path ? "border-sky-300 bg-sky-50/70" : "border-border bg-background",
          violation ? "border-amber-300 bg-amber-50/50" : "",
        )}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{label}</p>
              <FieldTypeBadge type={field.type} />
              <ConfidenceBadge confidence={field.confidence} />
              {approved ? (
                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                  Approved
                </span>
              ) : null}
            </div>
            <p className="font-mono text-xs text-muted-foreground">{field.path}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {field.page ? <span>Page {field.page}</span> : null}
              {!field.boundingBox || field.boundingBox.length !== 8 ? (
                <span>No bounding box available</span>
              ) : null}
            </div>
          </div>
          {violation ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              onClick={(event) => {
                event.stopPropagation();
                onApprove(field);
              }}
            >
              <Check className="size-4" />
              Approve
            </Button>
          ) : null}
        </div>
        <div className="mt-4">
          <label className="sr-only" htmlFor={`field-${field.path}`}>
            {field.path}
          </label>
          <input
            id={`field-${field.path}`}
            value={value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onValueChange(field, event.target.value)}
            className="flex min-h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        {violation ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
            <AlertCircle className="size-3.5" />
            Low confidence and still unreviewed
          </div>
        ) : null}
      </div>
    );
  }

  const children = getFieldChildren(field);

  return (
    <details open className="group rounded-2xl border bg-muted/10" style={{ marginLeft: level * 12 }}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="space-y-1">
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground">{label}</span>
            <FieldTypeBadge type={field.type} />
          </span>
          <span className="block font-mono text-xs text-muted-foreground">{field.path}</span>
        </span>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          {children.length} {children.length === 1 ? "item" : "items"}
          <ChevronDown className="size-4 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 border-t px-3 py-3">
        {children.map((child) => (
          <FieldTree
            key={child.path}
            field={child}
            level={level + 1}
            values={values}
            approvals={approvals}
            confidenceViolations={confidenceViolations}
            focusedPath={focusedPath}
            onSelectField={onSelectField}
            onValueChange={onValueChange}
            onApprove={onApprove}
          />
        ))}
      </div>
    </details>
  );
}

function ReviewPanel({
  job,
  processName,
  values,
  approvals,
  confidenceViolations,
  focusedPath,
  savePending,
  saveDisabled,
  onSelectField,
  onValueChange,
  onApprove,
  onSave,
  onBack,
}: {
  job: Job;
  processName: string;
  values: Map<string, string>;
  approvals: Set<string>;
  confidenceViolations: Set<string>;
  focusedPath: string | null;
  savePending: boolean;
  saveDisabled: boolean;
  onSelectField: (field: LeafField) => void;
  onValueChange: (field: LeafField, value: string) => void;
  onApprove: (field: LeafField) => void;
  onSave: () => void;
  onBack: () => void;
}) {
  return (
    <section className="rounded-3xl border bg-background p-6 shadow-sm">
      <div className="flex flex-col gap-4 border-b pb-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Human review
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{processName}</h1>
            <p className="text-sm text-muted-foreground">
              Detected form: <span className="font-medium text-foreground">{formatDetectedForm(job)}</span>
            </p>
          </div>
          <ReviewedIndicator reviewedAt={job.reviewedAt} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusBadge status={job.status} />
          <span className="text-sm text-muted-foreground">{job.fileName}</span>
          {job.averageConfidence !== null && job.averageConfidence !== undefined ? (
            <span className="text-sm text-muted-foreground">
              Average confidence: <AverageConfidenceValue averageConfidence={job.averageConfidence} />
            </span>
          ) : null}
          {job.estimatedCostUsd !== null && job.estimatedCostUsd !== undefined ? (
            <span className="text-sm text-muted-foreground">
              Estimated cost: <EstimatedCostValue estimatedCostUsd={job.estimatedCostUsd} />
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-6 space-y-4">
        {job.fields?.map((field) => (
          <FieldTree
            key={field.path}
            field={field}
            level={0}
            values={values}
            approvals={approvals}
            confidenceViolations={confidenceViolations}
            focusedPath={focusedPath}
            onSelectField={onSelectField}
            onValueChange={onValueChange}
            onApprove={onApprove}
          />
        ))}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-3 border-t pt-6">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onSave} disabled={saveDisabled || savePending}>
          {savePending ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}

function NothingToReviewPanel({
  kind,
  processId,
  processName,
  onBack,
}: {
  kind: "unclassified" | "empty";
  processId: string;
  processName: string;
  onBack: () => void;
}) {
  const title =
    kind === "unclassified" ? "This document doesn’t match any accepted form." : "No fields were extracted.";
  const description =
    kind === "unclassified"
      ? `The pipeline completed, but the document did not belong to ${processName}. Review the document on the left or upload a different file from the process detail page.`
      : "The document was classified successfully, but the analyzer returned no field values to review.";

  return (
    <section className="rounded-3xl border bg-background p-6 shadow-sm">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Review outcome
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        {kind === "unclassified" ? (
          <Button asChild>
            <Link href={`/processes/${processId}`}>Upload another file</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function NotReviewablePanel({
  job,
  error,
  retrying,
  showManualRefresh,
  onRefresh,
  onRetry,
  onBack,
}: {
  job: Job;
  error: string;
  retrying: boolean;
  showManualRefresh: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  if (job.status === "failed") {
    return (
      <section className="rounded-3xl border bg-background p-6 shadow-sm">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Job failed
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{job.fileName}</h1>
          <p className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6 text-destructive">
            {error}
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border bg-background p-6 shadow-sm">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Processing
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{job.fileName}</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          This job is still {job.status}. The review editor will appear automatically when processing finishes.
        </p>
        {showManualRefresh ? (
          <p className="text-sm text-muted-foreground">
            Automatic polling paused after 10 minutes. Refresh manually to check for completion.
          </p>
        ) : null}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" variant="outline" onClick={onRefresh}>
          <RefreshCcw className="size-4" />
          Refresh
        </Button>
      </div>
    </section>
  );
}

export function InferenceReviewPage({
  processId,
  jobId,
}: {
  processId: string;
  jobId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const from = searchParams.get("from");
  const returnHref = useMemo(() => getReturnHref(processId, from), [from, processId]);

  const [currentPage, setCurrentPage] = useState(1);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [jobPollingStartedAt, setJobPollingStartedAt] = useState<string | null>(null);
  const [manualRefreshExpired, setManualRefreshExpired] = useState(false);
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [approvals, setApprovals] = useState<Set<string>>(new Set());

  const processQuery = useQuery({
    queryKey: queryKeys.processes.detail(processId),
    queryFn: () => api.getProcess(processId),
  });

  const jobQuery = useQuery({
    queryKey: queryKeys.jobs.detail(processId, jobId),
    queryFn: () => api.getJob(processId, jobId),
    refetchInterval: (query) => {
      const job = query.state.data as Job | undefined;

      if (!isJobInFlight(job)) {
        return false;
      }

      return getPollingInterval({
        startedAt: jobPollingStartedAt,
        fastMs: pollingIntervals.jobs.fastMs,
        slowMs: pollingIntervals.jobs.slowMs,
      });
    },
  });

  const documentQuery = useQuery({
    queryKey: [...queryKeys.jobs.detail(processId, jobId), "document"],
    queryFn: () => api.getJobDocument(processId, jobId),
    enabled: jobQuery.data?.status === "succeeded",
    staleTime: Infinity,
  });

  const leafFields = useMemo(() => collectLeafFields(jobQuery.data?.fields), [jobQuery.data?.fields]);
  const fieldsByPath = useMemo(
    () => new Map(leafFields.map((field) => [field.path, field])),
    [leafFields],
  );
  const values = useMemo(() => {
    const nextValues = new Map<string, string>();

    leafFields.forEach((field) => {
      nextValues.set(field.path, edits.get(field.path) ?? getInitialFieldValue(field));
    });

    return nextValues;
  }, [edits, leafFields]);
  const confidenceViolations = useMemo(
    () => new Set(jobQuery.data?.confidenceViolations ?? []),
    [jobQuery.data?.confidenceViolations],
  );
  const documentKind = useMemo(() => {
    if (!jobQuery.data || !documentQuery.data) {
      return "pdf" as const;
    }

    return getDocumentKind(documentQuery.data, jobQuery.data.fileName);
  }, [documentQuery.data, jobQuery.data]);
  const hasTouchedFields = edits.size > 0 || approvals.size > 0;
  const jobInFlight = isJobInFlight(jobQuery.data);

  useEffect(() => {
    if (jobInFlight && jobPollingStartedAt === null) {
      const timeoutId = window.setTimeout(() => {
        setJobPollingStartedAt(new Date().toISOString());
        setManualRefreshExpired(false);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    if (!jobInFlight && jobPollingStartedAt !== null) {
      const timeoutId = window.setTimeout(() => {
        setJobPollingStartedAt(null);
        setManualRefreshExpired(false);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [jobInFlight, jobPollingStartedAt]);

  useEffect(() => {
    if (!jobInFlight || !jobPollingStartedAt) {
      return;
    }

    const elapsedMs = Date.now() - new Date(jobPollingStartedAt).getTime();
    const remainingMs = pollingIntervals.timeoutMs - elapsedMs;
    const timeoutId = window.setTimeout(() => {
      setManualRefreshExpired(true);
    }, Math.max(remainingMs, 0));

    return () => window.clearTimeout(timeoutId);
  }, [jobId, jobInFlight, jobPollingStartedAt]);

  const reviewMutation = useMutation({
    mutationFn: (input: { fields: ReviewedField[] }) => api.reviewJob(processId, jobId, input),
    onSuccess: async (updatedJob) => {
      queryClient.setQueryData(queryKeys.jobs.detail(processId, jobId), updatedJob);
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
      router.push(returnHref);
    },
    onError: (error) => {
      showErrorToast(error, "Unable to save review");
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => api.retryJob(processId, jobId),
    onSuccess: async ({ jobId: nextJobId }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(processId) });
      router.replace(buildReviewHref(processId, nextJobId, from));
    },
    onError: (error) => {
      showErrorToast(error, "Unable to retry job");
    },
  });

  if (processQuery.isLoading || jobQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading inference review"
        description="Fetching the process, job details, and source document."
      />
    );
  }

  if (processQuery.isError || jobQuery.isError || !processQuery.data || !jobQuery.data) {
    return (
      <div className="mx-auto w-full max-w-7xl">
        <ErrorCard
          title="Could not load inference review"
          message={
            processQuery.isError
              ? getErrorMessage(processQuery.error)
              : jobQuery.isError
                ? getErrorMessage(jobQuery.error)
                : "The review screen could not be loaded."
          }
          onRetry={() => {
            void processQuery.refetch();
            void jobQuery.refetch();
            void documentQuery.refetch();
          }}
        />
      </div>
    );
  }

  const process = processQuery.data;
  const job = jobQuery.data;
  const currentPageOverlays = leafFields.filter(
    (field) => field.page === currentPage && field.boundingBox && field.boundingBox.length === 8,
  );

  function onSelectField(field: LeafField) {
    setFocusedPath(field.path);

    if (field.page) {
      setCurrentPage(field.page);
    }
  }

  function onSelectPath(path: string) {
    const field = fieldsByPath.get(path);
    setFocusedPath(path);

    if (field?.page) {
      setCurrentPage(field.page);
    }
  }

  function onValueChange(field: LeafField, nextValue: string) {
    const initialValue = getInitialFieldValue(field);

    setEdits((currentEdits) => {
      const nextEdits = new Map(currentEdits);

      if (nextValue === initialValue) {
        nextEdits.delete(field.path);
      } else {
        nextEdits.set(field.path, nextValue);
      }

      return nextEdits;
    });
  }

  function onApprove(field: LeafField) {
    setApprovals((currentApprovals) => new Set(currentApprovals).add(field.path));
  }

  function onManualRefresh() {
    setJobPollingStartedAt(new Date().toISOString());
    setManualRefreshExpired(false);
    void jobQuery.refetch();
  }

  function onSave() {
    const payload = buildReviewPayload({
      fieldsByPath,
      edits,
      approvals,
    });

    if (payload.fields.length === 0) {
      return;
    }

    reviewMutation.mutate(payload);
  }

  function renderDocumentPane() {
    if (job.status !== "succeeded") {
      return (
        <DocumentEmptyState
          title="Document preview waits for completion"
          description="The source document will render here as soon as the job reaches a succeeded state."
        />
      );
    }

    if (documentQuery.isLoading) {
      return (
        <DocumentEmptyState
          title="Loading document"
          description="Downloading the original upload for side-by-side review."
        />
      );
    }

    if (documentQuery.isError || !documentQuery.data) {
      return (
        <ErrorCard
          title="Could not load source document"
          message={documentQuery.isError ? getErrorMessage(documentQuery.error) : "The source document is unavailable."}
          onRetry={() => void documentQuery.refetch()}
        />
      );
    }

    if (documentKind === "image") {
      return (
        <ImageDocumentViewer
          blob={documentQuery.data}
          documentIdentity={`${job.id}:${documentKind}:${documentQuery.data.type}:${documentQuery.data.size}`}
          fileName={job.fileName}
          overlays={currentPageOverlays}
          focusedPath={focusedPath}
          onSelectPath={onSelectPath}
          page={job.pages?.[0]}
        />
      );
    }

    return (
      <PdfDocumentViewer
        blob={documentQuery.data}
        documentIdentity={`${job.id}:${documentKind}:${documentQuery.data.type}:${documentQuery.data.size}`}
        fileName={job.fileName}
        currentPage={currentPage}
        onCurrentPageChange={setCurrentPage}
        overlays={currentPageOverlays}
        focusedPath={focusedPath}
        onSelectPath={onSelectPath}
        pages={job.pages}
      />
    );
  }

  function renderRightPane() {
    if (job.status === "failed" || job.status === "queued" || job.status === "running") {
      return (
        <NotReviewablePanel
          job={job}
          error={job.error ?? "The job failed before review could begin."}
          retrying={retryMutation.isPending}
          showManualRefresh={jobInFlight && manualRefreshExpired}
          onRefresh={onManualRefresh}
          onRetry={() => retryMutation.mutate()}
          onBack={() => router.push(returnHref)}
        />
      );
    }

    if (job.unclassified) {
      return (
        <NothingToReviewPanel
          kind="unclassified"
          processId={processId}
          processName={process.name}
          onBack={() => router.push(returnHref)}
        />
      );
    }

    if (!job.fields || job.fields.length === 0) {
      return (
        <NothingToReviewPanel
          kind="empty"
          processId={processId}
          processName={process.name}
          onBack={() => router.push(returnHref)}
        />
      );
    }

    return (
      <ReviewPanel
        job={job}
        processName={process.name}
        values={values}
        approvals={approvals}
        confidenceViolations={confidenceViolations}
        focusedPath={focusedPath}
        savePending={reviewMutation.isPending}
        saveDisabled={!hasTouchedFields}
        onSelectField={onSelectField}
        onValueChange={onValueChange}
        onApprove={onApprove}
        onSave={onSave}
        onBack={() => router.push(returnHref)}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link
          href={returnHref}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section className="rounded-3xl border bg-background p-6 shadow-sm">{renderDocumentPane()}</section>
        {renderRightPane()}
      </div>
    </div>
  );
}
