"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AuthenticationSection } from "@/components/integrations/auth-section";
import { IntegrationsContextBar } from "@/components/integrations/context-bar";
import {
  type AuthMode,
  type EndpointId,
  type GeneratedUserToken,
  DOCUMENTED_ENDPOINT_COUNT,
} from "@/components/integrations/endpoint-catalog";
import { EndpointReference } from "@/components/integrations/endpoint-reference";
import { ErrorsSection } from "@/components/integrations/errors-section";
import { IntegrationFlowDiagram } from "@/components/integrations/flow-diagram";
import { TryItConsole } from "@/components/integrations/try-it-console";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { api, type BusinessProcess } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

function ProcessKpiGrid({ processes }: { processes: BusinessProcess[] }) {
  const readyProcesses = processes.filter((process) => process.routingAnalyzerStatus === "ready").length;
  const readyPercent = processes.length > 0 ? Math.round((readyProcesses / processes.length) * 100) : 0;

  const items: Array<{
    label: string;
    value: string;
    caption: string;
    valueClassName?: string;
    captionClassName?: string;
  }> = [
    {
      label: "Business processes",
      value: String(processes.length),
      caption: processes.length === 1 ? "1 active pipeline" : `${processes.length} active pipelines`,
    },
    {
      label: "Ready to trigger",
      value: `${readyProcesses}`,
      caption: processes.length > 0 ? `${readyPercent}% of processes` : "No processes registered",
      valueClassName: "text-success",
    },
    {
      label: "Documented endpoints",
      value: String(DOCUMENTED_ENDPOINT_COUNT),
      caption: "token, trigger, jobs, summary, detail, retry",
      captionClassName: "font-mono",
    },
    {
      label: "Auth methods",
      value: "3",
      caption: "cookie, user token, service token",
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex h-full flex-col justify-between p-4">
            <p className="text-label-caps text-muted-foreground">{item.label}</p>
            <p className={`mt-2 font-heading text-2xl font-semibold tabular-figures text-foreground ${item.valueClassName ?? ""}`}>
              {item.value}
            </p>
            <p className={`mt-1 text-xs text-muted-foreground ${item.captionClassName ?? ""}`}>
              {item.caption}
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function EmptyIntegrationsState() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon name="hub" size={22} />
          </div>
          <div>
            <h2 className="text-headline-md text-foreground">No integration targets available</h2>
            <p className="mt-1 max-w-2xl text-body-md text-muted-foreground">
              Create a business process first. This screen documents the real process-driven API surface and does not invent integration targets on its own.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function IntegrationsPage() {
  const { user } = useSession();
  const [selectedProcessId, setSelectedProcessId] = useState<string>();
  const [selectedEndpointId, setSelectedEndpointId] = useState<EndpointId>("trigger-job");
  const [authMode, setAuthMode] = useState<AuthMode>("user-token");
  const [generatedToken, setGeneratedToken] = useState<GeneratedUserToken | null>(null);
  const [timelineStep, setTimelineStep] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const processesQuery = useQuery({
    queryKey: queryKeys.processes.all,
    queryFn: api.listProcesses,
  });

  const processes = useMemo(() => processesQuery.data ?? [], [processesQuery.data]);

  const selectedProcess = useMemo(() => {
    const match = processes.find((process) => process.id === selectedProcessId);
    return match ?? processes[0];
  }, [processes, selectedProcessId]);

  useEffect(() => {
    if (!generatedToken) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [generatedToken]);

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
          message="The process catalog could not be loaded, so the integrations workspace cannot be personalized yet."
          onRetry={() => void processesQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-gutter">
      <section className="rounded-xl border border-border/70 bg-card p-margin">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-4xl space-y-2">
            <div className="flex items-center gap-2.5">
              <Icon name="terminal" size={26} className="text-primary" />
              <h1 className="text-headline-lg text-foreground">API &amp; Integrations</h1>
            </div>
            <p className="max-w-3xl text-body-md text-muted-foreground">
              Everything your integration team needs to send documents into a business process and read the results back.
            </p>
          </div>

          <Button variant="outline" asChild>
            <a href="/api/openapi.json" target="_blank" rel="noreferrer">
              <Icon name="download" size={16} />
              Download OpenAPI spec
            </a>
          </Button>
        </div>
      </section>

      {processes.length === 0 ? (
        <EmptyIntegrationsState />
      ) : selectedProcess ? (
        <>
          <IntegrationsContextBar
            processes={processes}
            selectedProcess={selectedProcess}
            onSelectProcess={setSelectedProcessId}
          />

          <ProcessKpiGrid processes={processes} />

          <IntegrationFlowDiagram />

          <TryItConsole
            process={selectedProcess}
            selectedEndpointId={selectedEndpointId}
            onSelectEndpoint={setSelectedEndpointId}
            authMode={authMode}
            onAuthModeChange={setAuthMode}
            generatedToken={generatedToken}
            timelineStep={timelineStep}
            onRunSampleRequest={() => setTimelineStep((current) => (current + 1) % 4)}
            now={now}
          />

          <EndpointReference process={selectedProcess} />

          <AuthenticationSection
            sessionUser={user}
            generatedToken={generatedToken}
            onGeneratedToken={setGeneratedToken}
            now={now}
          />

          <ErrorsSection />
        </>
      ) : null}
    </div>
  );
}
