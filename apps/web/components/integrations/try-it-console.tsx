"use client";

import { useMemo, useRef, useState } from "react";

import { SectionHeader } from "@/components/brand/primitives";
import { CopyButton } from "@/components/integrations/copy-button";
import {
  type AuthMode,
  type EndpointId,
  type GeneratedUserToken,
  type SnippetLanguage,
  type TimelineStage,
  buildSampleResponse,
  ENDPOINT_CATALOG,
  getEndpointDefinition,
  SAMPLE_FILE_NAME,
  TIMELINE_STAGES,
} from "@/components/integrations/endpoint-catalog";
import {
  buildAuthorizationPreview,
  generateSnippet,
} from "@/components/integrations/snippets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BusinessProcess } from "@/lib/api";
import { cn } from "@/lib/utils";

function methodChipClasses(method: "GET" | "POST") {
  return method === "POST"
    ? "bg-primary/10 text-primary"
    : "bg-secondary/15 text-secondary";
}

function Timeline({ stage, visible }: { stage: TimelineStage; visible: boolean }) {
  if (!visible) {
    return (
      <div className="border-t border-white/10 pt-4 text-xs text-slate-400">
        This endpoint returns immediately; there is no document-processing timeline to simulate.
      </div>
    );
  }

  const activeIndex = TIMELINE_STAGES.indexOf(stage);

  return (
    <div className="border-t border-white/10 pt-4">
      <p className="mb-3 text-[11px] font-semibold tracking-[0.18em] text-slate-400 uppercase">
        Processing timeline simulation
      </p>
      <div className="relative flex items-start justify-between gap-3 px-1">
        <div className="absolute inset-x-4 top-3 h-px bg-slate-700" />
        {TIMELINE_STAGES.map((item, index) => {
          const complete = index < activeIndex;
          const current = index === activeIndex;

          return (
            <div key={item} className="relative z-10 flex flex-1 flex-col items-center gap-2">
              <div
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold",
                  complete
                    ? "border-teal-400 bg-teal-500 text-slate-950"
                    : current
                      ? "border-amber-300 bg-amber-400 text-slate-950"
                      : "border-slate-600 bg-slate-900 text-slate-400",
                )}
              >
                {complete ? "✓" : index + 1}
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  complete ? "text-teal-300" : current ? "text-amber-200" : "text-slate-400",
                )}
              >
                {item}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TryItConsole({
  process,
  selectedEndpointId,
  onSelectEndpoint,
  authMode,
  onAuthModeChange,
  generatedToken,
  timelineStep,
  onRunSampleRequest,
  now,
}: {
  process: BusinessProcess;
  selectedEndpointId: EndpointId;
  onSelectEndpoint: (endpointId: EndpointId) => void;
  authMode: AuthMode;
  onAuthModeChange: (mode: AuthMode) => void;
  generatedToken: GeneratedUserToken | null;
  timelineStep: number;
  onRunSampleRequest: () => void;
  now: number;
}) {
  const [language, setLanguage] = useState<SnippetLanguage>("curl");
  const snippetRef = useRef<HTMLPreElement | null>(null);
  const responseRef = useRef<HTMLPreElement | null>(null);
  const endpoint = getEndpointDefinition(selectedEndpointId);
  const timelineStage = TIMELINE_STAGES[timelineStep] ?? TIMELINE_STAGES[0];

  const snippet = useMemo(
    () =>
      generateSnippet({
        language,
        endpointId: selectedEndpointId,
        process,
        authMode,
        generatedToken,
      }),
    [authMode, generatedToken, language, process, selectedEndpointId],
  );

  const responseSample = useMemo(
    () =>
      buildSampleResponse({
        endpointId: selectedEndpointId,
        process,
        generatedToken,
        timelineStage,
      }),
    [generatedToken, process, selectedEndpointId, timelineStage],
  );

  const authorizationPreview = buildAuthorizationPreview({
    endpointId: selectedEndpointId,
    authMode,
    generatedToken,
    now,
  });

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Try it"
        description="Build a request, switch auth modes, and see a realistic sample response."
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col lg:flex-row">
          <CardContent className="space-y-5 border-b border-border/70 bg-card p-5 lg:w-[42%] lg:border-r lg:border-b-0">
            <div>
              <p className="mb-2 text-label-caps text-muted-foreground">Select endpoint</p>
              <div className="space-y-1">
                {ENDPOINT_CATALOG.map((item) => {
                  const active = item.id === selectedEndpointId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectEndpoint(item.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary/30 bg-primary/5"
                          : "border-transparent hover:bg-muted/60",
                      )}
                    >
                      <span className="flex items-center gap-2 font-mono text-xs">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            methodChipClasses(item.method),
                          )}
                        >
                          {item.method}
                        </span>
                        <span className={active ? "text-primary" : "text-foreground"}>
                          {item.pathTemplate}
                        </span>
                      </span>
                      {active ? <Icon name="chevron_right" size={16} className="text-primary" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-label-caps text-muted-foreground">Authentication mode</p>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/70 bg-muted p-1">
                {[
                  { id: "session-cookie", label: "Session cookie" },
                  { id: "user-token", label: "User token" },
                  { id: "service-token", label: "Service token" },
                ].map((item) => {
                  const selected = item.id === authMode;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onAuthModeChange(item.id as AuthMode)}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                        selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div data-testid="auth-preview">
              <div className="mb-1 flex items-center justify-between gap-3">
                <p className="text-label-caps text-muted-foreground">Authorization header</p>
                {authorizationPreview.copyValue ? (
                  <CopyButton
                    value={authorizationPreview.copyValue}
                    label="Copy"
                    copiedLabel="Copied"
                    size="xs"
                  />
                ) : null}
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs">
                {authorizationPreview.value ? (
                  <code className="break-all font-mono text-foreground">{authorizationPreview.value}</code>
                ) : (
                  <p className="text-foreground">{authorizationPreview.description}</p>
                )}
              </div>
              {authorizationPreview.value ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{authorizationPreview.description}</p>
              ) : null}
            </div>

            {endpoint.supportsFileUpload ? (
              <div>
                <p className="mb-2 text-label-caps text-muted-foreground">Document payload (file)</p>
                <div className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon name="picture_as_pdf" size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{SAMPLE_FILE_NAME}</p>
                      <p className="text-[11px] text-muted-foreground">
                        1.2 MB · Ready for multipart/form-data
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">Simulated upload</Badge>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Button type="button" className="w-full" onClick={onRunSampleRequest}>
                <Icon name="arrow_forward" size={16} />
                Run sample request
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Runs against sample data — nothing is sent to production.
              </p>
            </div>
          </CardContent>

          <div className="flex flex-col bg-slate-950 text-slate-100 lg:w-[58%]">
            <div className="flex flex-1 flex-col gap-4 p-5">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                <Tabs value={language} onValueChange={(value) => setLanguage(value as SnippetLanguage)}>
                  <TabsList variant="line" className="bg-transparent p-0">
                    <TabsTrigger value="curl" className="text-slate-400 data-active:text-slate-50">
                      cURL
                    </TabsTrigger>
                    <TabsTrigger value="typescript" className="text-slate-400 data-active:text-slate-50">
                      TypeScript
                    </TabsTrigger>
                    <TabsTrigger value="python" className="text-slate-400 data-active:text-slate-50">
                      Python
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <CopyButton
                  value={snippet}
                  label="Copy snippet"
                  copiedLabel="Copied"
                  variant="outline"
                  size="sm"
                  fallbackTargetRef={snippetRef}
                  className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                />
              </div>

              <pre
                ref={snippetRef}
                className="overflow-x-auto rounded-lg border border-white/10 bg-slate-900 p-3 text-[12px] leading-6 text-slate-200"
              >
                <code>{snippet}</code>
              </pre>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-label-caps text-slate-400">Expected response</p>
                    <Badge variant={endpoint.responseStatus === "202 Accepted" ? "warning" : "success"}>
                      {endpoint.responseStatus}
                    </Badge>
                  </div>
                  <CopyButton
                    value={JSON.stringify(responseSample, null, 2)}
                    label="Copy response"
                    copiedLabel="Copied"
                    variant="outline"
                    size="sm"
                    fallbackTargetRef={responseRef}
                    className="border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
                  />
                </div>
                <pre
                  ref={responseRef}
                  className="overflow-x-auto rounded-lg border border-white/10 bg-slate-900 p-3 text-[12px] leading-6 text-slate-200"
                >
                  <code>{JSON.stringify(responseSample, null, 2)}</code>
                </pre>
              </div>
            </div>

            <div className="px-5 pb-5">
              <Timeline stage={timelineStage} visible={endpoint.supportsTimeline} />
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
