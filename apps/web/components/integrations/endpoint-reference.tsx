"use client";

import { useMemo, useState } from "react";

import { SectionHeader } from "@/components/brand/primitives";
import {
  buildSampleResponse,
  ENDPOINT_CATALOG,
  type EndpointId,
  type TimelineStage,
} from "@/components/integrations/endpoint-catalog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { BusinessProcess } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATIC_TIMELINE: TimelineStage = "completed";

export function EndpointReference({ process }: { process: BusinessProcess }) {
  const [openEndpointId, setOpenEndpointId] = useState<EndpointId | null>("auth-token");

  const responseSamples = useMemo(
    () =>
      Object.fromEntries(
        ENDPOINT_CATALOG.map((endpoint) => [
          endpoint.id,
          JSON.stringify(
            buildSampleResponse({
              endpointId: endpoint.id,
              process,
              generatedToken: null,
              timelineStage: STATIC_TIMELINE,
            }),
            null,
            2,
          ),
        ]),
      ) as Record<EndpointId, string>,
    [process],
  );

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Endpoint reference"
        description="The six real API surfaces used to authenticate, trigger processing, poll jobs, summarize results, and retry failures."
      />

      <div className="space-y-3">
        {ENDPOINT_CATALOG.map((endpoint) => {
          const expanded = endpoint.id === openEndpointId;

          return (
            <Card key={endpoint.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 p-4 text-left"
                aria-expanded={expanded}
                onClick={() => setOpenEndpointId(expanded ? null : endpoint.id)}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={endpoint.responseStatus === "202 Accepted" ? "warning" : "success"}>
                      {endpoint.responseStatus}
                    </Badge>
                    <span className="font-mono text-sm text-foreground">
                      {endpoint.method} {endpoint.pathTemplate}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{endpoint.purpose}</p>
                </div>

                <Icon
                  name="expand_more"
                  size={18}
                  className={cn("text-muted-foreground transition-transform", expanded && "rotate-180")}
                />
              </button>

              {expanded ? (
                <CardContent className="grid gap-gutter border-t border-border/70 p-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-medium text-foreground">Request details</h3>
                      <div className="mt-3 overflow-hidden rounded-lg border border-border/70">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-muted/40 text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">Location</th>
                              <th className="px-3 py-2 font-medium">Name</th>
                              <th className="px-3 py-2 font-medium">Required</th>
                              <th className="px-3 py-2 font-medium">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {endpoint.requestDetails.map((field) => (
                              <tr key={`${field.location}-${field.name}`} className="border-t border-border/70">
                                <td className="px-3 py-2 text-muted-foreground">{field.location}</td>
                                <td className="px-3 py-2 font-mono text-xs text-foreground">{field.name}</td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {field.required ? "Yes" : "Optional"}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground">{field.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-medium text-foreground">Integration notes</h3>
                      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                        {endpoint.integrationNotes.map((note) => (
                          <li key={note} className="flex gap-2">
                            <Icon name="check_circle" size={16} className="mt-0.5 text-primary" />
                            <span>{note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium text-foreground">Response sample</h3>
                    <pre className="mt-3 overflow-x-auto rounded-lg border border-border/70 bg-foreground p-4 text-[12px] leading-6 text-background">
                      <code>{responseSamples[endpoint.id]}</code>
                    </pre>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
