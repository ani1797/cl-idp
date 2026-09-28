"use client";

import { type ComponentProps, type ReactNode, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { EnvironmentBadge, KpiCard, SectionHeader } from "@/components/brand/primitives";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type BusinessProcess } from "@/lib/api";
import { confidenceThresholdFloatToPercent } from "@/lib/process-threshold";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

type CodeTone = "plain" | "muted" | "keyword" | "string" | "property" | "type" | "comment";
type CodeToken = { text: string; tone?: CodeTone };
type CodeLine = CodeToken[];

const routingStatusVariants: Record<
  BusinessProcess["routingAnalyzerStatus"],
  "success" | "warning" | "destructive"
> = {
  building: "warning",
  ready: "success",
  failed: "destructive",
};

const routingStatusIcons: Record<
  BusinessProcess["routingAnalyzerStatus"],
  "progress_activity" | "check_circle" | "error"
> = {
  building: "progress_activity",
  ready: "check_circle",
  failed: "error",
};

function codeToneClass(tone: CodeTone = "plain") {
  switch (tone) {
    case "muted":
      return "text-background/65";
    case "keyword":
      return "text-brand-teal-light";
    case "string":
      return "text-brand-gold";
    case "property":
      return "text-brand-neutral";
    case "type":
      return "text-primary-foreground";
    case "comment":
      return "text-background/55 italic";
    case "plain":
    default:
      return "text-background";
  }
}

function formatPercent(value: number) {
  return `${confidenceThresholdFloatToPercent(value)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function ProcessStatusBadge({ status }: { status: BusinessProcess["routingAnalyzerStatus"] }) {
  return (
    <Badge variant={routingStatusVariants[status]} className="capitalize">
      <Icon name={routingStatusIcons[status]} size={14} />
      {status}
    </Badge>
  );
}

function StaticReferenceBadge() {
  return (
    <Badge variant="info" className="text-label-caps">
      Static reference
    </Badge>
  );
}

function CodePanel({
  badge,
  title,
  description,
  icon,
  lines,
  footer,
  className,
}: {
  badge?: ReactNode;
  title: string;
  description: string;
  icon: ComponentProps<typeof Icon>["name"];
  lines: CodeLine[];
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="border-b border-border/70 bg-muted/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Icon name={icon} size={18} className="text-primary" />
              <CardTitle>{title}</CardTitle>
              {badge}
            </div>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <pre className="overflow-x-auto bg-foreground px-4 py-4 text-[13px] leading-6 tabular-figures">
          <code>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex} className="block whitespace-pre">
                {line.map((token, tokenIndex) => (
                  <span key={`${lineIndex}-${tokenIndex}`} className={codeToneClass(token.tone)}>
                    {token.text}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
        {footer ? <div className="border-t border-border/70 px-4 py-3 text-sm text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

function FaultCodeCard({
  status,
  title,
  description,
}: {
  status: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
      <Badge variant="warning" className="mt-0.5 min-w-12 justify-center tabular-figures">
        {status}
      </Badge>
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function processSnippetTarget(process: BusinessProcess) {
  return `/processes/${process.id}`;
}

function buildTriggerRequestLines(process: BusinessProcess): CodeLine[] {
  return [
    [
      { text: "const", tone: "keyword" },
      { text: " formData", tone: "plain" },
      { text: " = ", tone: "plain" },
      { text: "new", tone: "keyword" },
      { text: " FormData();", tone: "type" },
    ],
    [{ text: "formData.append(\"file\", file, file.name);", tone: "plain" }],
    [],
    [
      { text: "const", tone: "keyword" },
      { text: " response", tone: "plain" },
      { text: " = ", tone: "plain" },
      { text: "await", tone: "keyword" },
      { text: " fetch(", tone: "plain" },
      { text: `\"${processSnippetTarget(process)}/trigger\"`, tone: "string" },
      { text: ", {", tone: "plain" },
    ],
    [
      { text: "  method", tone: "property" },
      { text: ": ", tone: "plain" },
      { text: '"POST"', tone: "string" },
      { text: ",", tone: "plain" },
    ],
    [
      { text: "  credentials", tone: "property" },
      { text: ": ", tone: "plain" },
      { text: '"include"', tone: "string" },
      { text: ",", tone: "plain" },
    ],
    [
      { text: "  body", tone: "property" },
      { text: ": formData,", tone: "plain" },
    ],
    [{ text: "});", tone: "plain" }],
    [],
    [
      { text: "const", tone: "keyword" },
      { text: " receipt", tone: "plain" },
      { text: " = ", tone: "plain" },
      { text: "await", tone: "keyword" },
      { text: " response.json();", tone: "plain" },
    ],
    [
      { text: "// receipt => ", tone: "comment" },
      { text: "{", tone: "plain" },
      { text: ' jobId: ', tone: "property" },
      { text: '"<job-id>" ', tone: "string" },
      { text: "}", tone: "plain" },
    ],
  ];
}

const jobTypeLines: CodeLine[] = [
  [{ text: "type", tone: "keyword" }, { text: " Job = {", tone: "type" }],
  [{ text: "  id", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  processId", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  fileName", tone: "property" }, { text: ": string;", tone: "plain" }],
  [
    { text: "  status", tone: "property" },
    { text: ': ', tone: "plain" },
    { text: '"queued"', tone: "string" },
    { text: " | ", tone: "plain" },
    { text: '"running"', tone: "string" },
    { text: " | ", tone: "plain" },
    { text: '"succeeded"', tone: "string" },
    { text: " | ", tone: "plain" },
    { text: '"failed"', tone: "string" },
    { text: ";", tone: "plain" },
  ],
  [{ text: "  submittedAt", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  completedAt?", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  detectedForm?", tone: "property" }, { text: ": string | null;", tone: "plain" }],
  [{ text: "  detectedFormName?", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  unclassified?", tone: "property" }, { text: ": boolean;", tone: "plain" }],
  [{ text: "  retryOfJobId?", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  pages?", tone: "property" }, { text: ": PageInfo[];", tone: "plain" }],
  [{ text: "  fields?", tone: "property" }, { text: ": ExtractedField[];", tone: "plain" }],
  [{ text: "  fieldCount?", tone: "property" }, { text: ": number;", tone: "plain" }],
  [{ text: "  averageConfidence?", tone: "property" }, { text: ": number | null;", tone: "plain" }],
  [{ text: "  confidenceViolations?", tone: "property" }, { text: ": string[];", tone: "plain" }],
  [{ text: "  estimatedCostUsd?", tone: "property" }, { text: ": number | null;", tone: "plain" }],
  [{ text: "  error?", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  reviewedAt?", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "};", tone: "type" }],
];

const jobsSummaryLines: CodeLine[] = [
  [{ text: "type", tone: "keyword" }, { text: " JobsSummary = {", tone: "type" }],
  [{ text: "  total", tone: "property" }, { text: ": number;", tone: "plain" }],
  [{ text: "  needsReview", tone: "property" }, { text: ": number;", tone: "plain" }],
  [{ text: "  failed", tone: "property" }, { text: ": number;", tone: "plain" }],
  [{ text: "  unclassified", tone: "property" }, { text: ": number;", tone: "plain" }],
  [{ text: "  totalEstimatedCostUsd", tone: "property" }, { text: ": number;", tone: "plain" }],
  [{ text: "};", tone: "type" }],
];

const apiErrorLines: CodeLine[] = [
  [{ text: "type", tone: "keyword" }, { text: " ApiErrorBody = {", tone: "type" }],
  [{ text: "  code", tone: "property" }, { text: ": string;", tone: "plain" }],
  [{ text: "  message", tone: "property" }, { text: ": string;", tone: "plain" }],
  [
    { text: "  details?", tone: "property" },
    { text: ": Record<string, unknown>;", tone: "plain" },
  ],
  [{ text: "};", tone: "type" }],
];

export function IntegrationsPage() {
  const [selectedProcessId, setSelectedProcessId] = useState<string>();

  const processesQuery = useQuery({
    queryKey: queryKeys.processes.all,
    queryFn: api.listProcesses,
  });

  const processes = useMemo(() => processesQuery.data ?? [], [processesQuery.data]);

  const selectedProcess = useMemo(() => {
    const match = processes.find((process) => process.id === selectedProcessId);
    return match ?? processes[0];
  }, [processes, selectedProcessId]);

  const readyProcesses = processes.filter((process) => process.routingAnalyzerStatus === "ready").length;
  const selectedEndpointBase = selectedProcess ? processSnippetTarget(selectedProcess) : null;

  if (processesQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading integration targets"
        description="Fetching the live business process catalog and API reference context."
      />
    );
  }

  if (processesQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <ErrorCard
          title="Could not load integration targets"
          message="The process catalog could not be loaded, so the integrations reference cannot be personalized yet."
          onRetry={() => void processesQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-gutter">
      <section className="rounded-xl border border-border/70 bg-card p-margin">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Icon name="integration_instructions" size={24} className="text-primary" />
              <h1 className="text-headline-lg text-foreground">API &amp; Integrations</h1>
              <EnvironmentBadge />
            </div>
            <p className="max-w-3xl text-body-md text-muted-foreground">
              Connect external upload flows to the existing trigger and jobs endpoints. Integration
              targets below are live business processes from the API; code samples and fault-code
              notes are static reference content derived from the current frontend client and
              OpenAPI-generated types.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral" className="text-label-caps">
              {processes.length} live targets
            </Badge>
            <StaticReferenceBadge />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Registered targets"
          value={processes.length}
          caption={processes.length === 1 ? "1 business process" : `${processes.length} business processes`}
        />
        <KpiCard
          label="Ready to trigger"
          value={readyProcesses}
          caption={processes.length > 0 ? `${Math.round((readyProcesses / processes.length) * 100)}% of targets` : "No processes registered"}
        />
        <KpiCard
          label="Selected endpoint"
          value={selectedProcess ? "POST" : "—"}
          caption={selectedEndpointBase ? `${selectedEndpointBase}/trigger` : "Choose a process to personalize samples"}
        />
        <KpiCard
          label="Jobs API surfaces"
          value={3}
          caption="list, summary, and detail endpoints"
        />
      </section>

      <section className="space-y-gutter">
        <SectionHeader
          title="Integration targets"
          description="Real processes returned by listProcesses() power the selector and endpoint path examples."
          actions={
            processes.length > 0 ? (
              <div className="flex min-w-72 flex-col gap-2">
                <label htmlFor="integration-target-select" className="text-label-caps text-muted-foreground">
                  Selected process
                </label>
                <Select value={selectedProcess?.id} onValueChange={setSelectedProcessId}>
                  <SelectTrigger id="integration-target-select" aria-label="Integration target" className="w-full min-w-72 bg-card">
                    <SelectValue placeholder="Choose a process" />
                  </SelectTrigger>
                  <SelectContent>
                    {processes.map((process) => (
                      <SelectItem key={process.id} value={process.id}>
                        {process.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null
          }
        />

        {processes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col gap-3 py-8">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon name="hub" size={22} />
                </div>
                <div>
                  <h2 className="text-headline-md text-foreground">No integration targets available</h2>
                  <p className="mt-1 text-body-md text-muted-foreground">
                    Create a business process first. This screen only documents the existing process-based API surface and does not invent new endpoints.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-gutter xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="grid grid-cols-1 gap-gutter lg:grid-cols-2">
              {processes.map((process) => {
                const selected = process.id === selectedProcess?.id;

                return (
                  <button
                    key={process.id}
                    type="button"
                    onClick={() => setSelectedProcessId(process.id)}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border/70 bg-card hover:bg-muted/30",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-base font-semibold text-foreground">{process.name}</h3>
                          {selected ? (
                            <Badge variant="secondary" className="text-label-caps">
                              Selected
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm tabular-figures text-muted-foreground">{process.id}</p>
                      </div>
                      <ProcessStatusBadge status={process.routingAnalyzerStatus} />
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{process.description}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-label-caps text-muted-foreground">Owner</p>
                        <p className="mt-1 break-words text-foreground">{process.ownerEmail}</p>
                      </div>
                      <div>
                        <p className="text-label-caps text-muted-foreground">Threshold</p>
                        <p className="mt-1 tabular-figures text-foreground">{formatPercent(process.confidenceThreshold)}</p>
                      </div>
                      <div>
                        <p className="text-label-caps text-muted-foreground">Analyzers</p>
                        <p className="mt-1 tabular-figures text-foreground">{process.allowedAnalyzers.length}</p>
                      </div>
                      <div>
                        <p className="text-label-caps text-muted-foreground">Updated</p>
                        <p className="mt-1 text-foreground">{formatDate(process.updatedAt)}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedProcess ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Icon name="api" size={18} className="text-primary" />
                    <CardTitle>Selected target details</CardTitle>
                  </div>
                  <CardDescription>
                    Live metadata from the current BusinessProcess record shapes the reference snippets below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-label-caps text-muted-foreground">Current process</p>
                        <p className="mt-1 font-medium text-foreground">{selectedProcess.name}</p>
                        <p className="mt-1 text-sm tabular-figures text-muted-foreground">{selectedProcess.id}</p>
                      </div>
                      <ProcessStatusBadge status={selectedProcess.routingAnalyzerStatus} />
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <p>
                        Trigger: <span className="tabular-figures text-foreground">POST {selectedEndpointBase}/trigger</span>
                      </p>
                      <p>
                        Jobs list: <span className="tabular-figures text-foreground">GET {selectedEndpointBase}/jobs</span>
                      </p>
                      <p>
                        Jobs summary: <span className="tabular-figures text-foreground">GET {selectedEndpointBase}/jobs/summary</span>
                      </p>
                      <p>
                        Job detail: <span className="tabular-figures text-foreground">GET {selectedEndpointBase}/jobs/{"{jobId}"}</span>
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-label-caps text-muted-foreground">Allowed analyzers</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedProcess.allowedAnalyzers.map((analyzer) => (
                        <Badge key={analyzer.id} variant="outline" className="max-w-full">
                          <span className="truncate">{analyzer.name}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {selectedProcess.routingAnalyzerStatus !== "ready" ? (
                    <div className="rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning">
                      <div className="flex items-start gap-2">
                        <Icon name={selectedProcess.routingAnalyzerStatus === "failed" ? "error" : "info"} size={16} className="mt-0.5" />
                        <div>
                          <p className="font-medium">Uploads are not trigger-ready yet.</p>
                          <p className="mt-1 text-warning">
                            The backend documents that trigger requests are rejected with 409 while a process routing analyzer is building or has failed.
                          </p>
                          {selectedProcess.routingAnalyzerError ? (
                            <p className="mt-2 text-warning">Current error: {selectedProcess.routingAnalyzerError}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </section>

      {selectedProcess ? (
        <section className="space-y-gutter">
          <SectionHeader
            title="Reference request and response shapes"
            description="Static samples derived from api.triggerJob(), api.getJob(), api.listJobs(), api.getJobsSummary(), and the generated schema types."
          />

          <div className="grid grid-cols-1 gap-gutter xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <CodePanel
              icon="upload_file"
              title="Trigger a job for the selected process"
              description="Multipart upload to the existing trigger endpoint. The web client authenticates with the session cookie, so requests are credentialed."
              badge={<StaticReferenceBadge />}
              lines={buildTriggerRequestLines(selectedProcess)}
              footer={
                <span>
                  The only multipart field accepted by the current client helper is <code className="tabular-figures text-foreground">file</code>. A successful trigger returns HTTP 202 with <code className="tabular-figures text-foreground">{`{ jobId: string }`}</code>.
                </span>
              }
            />

            <div className="grid grid-cols-1 gap-gutter">
              <CodePanel
                icon="receipt_long"
                title="Job resource shape"
                description="Top-level fields on Job responses used by the jobs list and job detail APIs."
                badge={<StaticReferenceBadge />}
                lines={jobTypeLines}
                footer="Job detail responses may include pages and fields; listJobs() items omit full field payloads and rely on fieldCount instead."
              />
              <CodePanel
                icon="description"
                title="Jobs summary shape"
                description="Aggregate counts returned by GET /processes/{id}/jobs/summary."
                badge={<StaticReferenceBadge />}
                lines={jobsSummaryLines}
                footer="totalEstimatedCostUsd is an estimated Content Understanding cost derived by the backend, not an actual billing export."
              />
            </div>
          </div>
        </section>
      ) : null}

      {selectedProcess ? (
        <section className="grid grid-cols-1 gap-gutter xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <CodePanel
            icon="error"
            title="Shared API error envelope"
            description="ApiErrorBody is the structured JSON error shape parsed by readErrorBody() in the current web client."
            badge={<StaticReferenceBadge />}
            lines={apiErrorLines}
            footer="Framework-level validation errors can also surface as 422 responses. Application-defined 4xx/5xx responses use this envelope."
          />

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Icon name="sync_problem" size={18} className="text-primary" />
                <CardTitle>Common HTTP fault codes</CardTitle>
                <StaticReferenceBadge />
              </div>
              <CardDescription>
                Grounded in lib/api.ts and the existing FastAPI routers under apps/api/app/routers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <FaultCodeCard
                status={401}
                title="Unauthenticated"
                description="Auth routes declare 401 responses, and the web client sends every request with credentials include because the session lives in an httpOnly cookie."
              />
              <FaultCodeCard
                status={404}
                title="Process or job not found"
                description="Returned when the selected process ID or a downstream job ID does not exist for the requested route."
              />
              <FaultCodeCard
                status={409}
                title="Process not ready or retry conflict"
                description="Trigger and retry routes declare 409 responses when the routing analyzer is not ready or a retry is not currently allowed."
              />
              <FaultCodeCard
                status={400}
                title="Invalid upload or review request"
                description="The trigger and review routers use 400 for unsupported file types, oversized files, invalid documents, too many pages, or bad reviewed field paths."
              />
              <FaultCodeCard
                status={422}
                title="Request validation"
                description="FastAPI can emit 422 when the request shape itself is invalid, such as malformed multipart payloads before the app-specific handler runs."
              />
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
