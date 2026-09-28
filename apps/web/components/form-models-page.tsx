"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ConfidenceBadge } from "@/components/brand/confidence-badge";
import { KpiCard, SectionHeader } from "@/components/brand/primitives";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type Analyzer, type BusinessProcess } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type AnalyzerCatalogFilter = "all" | Analyzer["kind"];
type AnalyzerRuntimeMetadata = Analyzer & Record<string, unknown>;
const EMPTY_ANALYZERS: Analyzer[] = [];
const EMPTY_PROCESSES: BusinessProcess[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countFields(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isRecord(value)) {
    return Object.keys(value).length;
  }

  return null;
}

function getFieldSchemaCount(analyzer: Analyzer): number | null {
  const runtimeAnalyzer = analyzer as AnalyzerRuntimeMetadata;

  return (
    countFields(runtimeAnalyzer.fieldSchema) ??
    countFields(runtimeAnalyzer.fields) ??
    (isRecord(runtimeAnalyzer.schema)
      ? countFields(runtimeAnalyzer.schema.fieldSchema) ??
        countFields(runtimeAnalyzer.schema.fields)
      : null)
  );
}

function getBaselineConfidencePercent(analyzer: Analyzer): number | null {
  const runtimeAnalyzer = analyzer as AnalyzerRuntimeMetadata;
  const candidates = [
    runtimeAnalyzer.baselineConfidencePercent,
    runtimeAnalyzer.baselineConfidence,
    runtimeAnalyzer.recommendedBaselineConfidencePercent,
    runtimeAnalyzer.recommendedBaselineConfidence,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      continue;
    }

    if (candidate <= 1) {
      return candidate * 100;
    }

    return candidate;
  }

  return null;
}

function formatCatalogKind(kind: Analyzer["kind"]) {
  return kind === "prebuilt" ? "Prebuilt" : "Custom";
}

function buildConnectedProcesses(processes: BusinessProcess[]) {
  const map = new Map<string, BusinessProcess[]>();

  for (const process of processes) {
    for (const analyzerId of process.allowedAnalyzerIds) {
      const connectedProcesses = map.get(analyzerId) ?? [];
      connectedProcesses.push(process);
      map.set(analyzerId, connectedProcesses);
    }
  }

  return map;
}

function buildSearchText(analyzer: Analyzer, connectedProcesses: BusinessProcess[]) {
  return [
    analyzer.id,
    analyzer.name,
    analyzer.description ?? "",
    analyzer.kind,
    ...connectedProcesses.flatMap((process) => [process.id, process.name, process.description]),
  ]
    .join(" ")
    .toLowerCase();
}

function ConnectedProcessLinks({
  analyzerId,
  processes,
}: {
  analyzerId: string;
  processes: BusinessProcess[];
}) {
  if (processes.length === 0) {
    return <span className="text-sm text-muted-foreground">Not connected</span>;
  }

  const visibleProcesses = processes.slice(0, 3);
  const remaining = processes.length - visibleProcesses.length;

  return (
    <div className="space-y-2">
      <Badge variant="neutral" className="tabular-figures">
        {processes.length} connected
      </Badge>
      <ul className="space-y-1">
        {visibleProcesses.map((process) => (
          <li key={`${analyzerId}-${process.id}`}>
            <Link
              href={`/processes/${process.id}`}
              className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            >
              <Icon name="account_tree" size={14} />
              <span>{process.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <p className="text-xs text-muted-foreground">+{remaining} more connected processes</p>
      ) : null}
    </div>
  );
}

export function FormModelsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [kindFilter, setKindFilter] = useState<AnalyzerCatalogFilter>("all");

  const analyzersQuery = useQuery({
    queryKey: queryKeys.analyzers,
    queryFn: api.listAnalyzers,
  });
  const processesQuery = useQuery({
    queryKey: queryKeys.processes.all,
    queryFn: api.listProcesses,
  });

  const analyzers = analyzersQuery.data ?? EMPTY_ANALYZERS;
  const processes = processesQuery.data ?? EMPTY_PROCESSES;
  const connectedProcessesByAnalyzerId = useMemo(
    () => buildConnectedProcesses(processes),
    [processes],
  );

  const catalogRows = useMemo(
    () =>
      analyzers.map((analyzer) => {
        const connectedProcesses = connectedProcessesByAnalyzerId.get(analyzer.id) ?? [];
        return {
          analyzer,
          connectedProcesses,
          fieldSchemaCount: getFieldSchemaCount(analyzer),
          baselineConfidencePercent: getBaselineConfidencePercent(analyzer),
          searchText: buildSearchText(analyzer, connectedProcesses),
        };
      }),
    [analyzers, connectedProcessesByAnalyzerId],
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return catalogRows.filter(({ analyzer, searchText }) => {
      const matchesKind = kindFilter === "all" || analyzer.kind === kindFilter;
      const matchesSearch = normalizedSearch.length === 0 || searchText.includes(normalizedSearch);
      return matchesKind && matchesSearch;
    });
  }, [catalogRows, kindFilter, searchTerm]);

  const connectedAnalyzerCount = catalogRows.filter(
    ({ connectedProcesses }) => connectedProcesses.length > 0,
  ).length;
  const unassignedAnalyzerCount = analyzers.length - connectedAnalyzerCount;
  const prebuiltCount = analyzers.filter((analyzer) => analyzer.kind === "prebuilt").length;
  const customCount = analyzers.length - prebuiltCount;

  if (analyzersQuery.isLoading || processesQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading form models"
        description="Fetching analyzer metadata and connected business processes."
      />
    );
  }

  if (analyzersQuery.isError || processesQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <ErrorCard
          title="Could not load form models"
          message="The form model catalog could not be loaded. Please try again."
          onRetry={() => {
            void analyzersQuery.refetch();
            void processesQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-gutter">
      <section className="flex flex-col gap-gutter">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-headline-lg text-foreground">Form Models</h1>
            <Badge variant="neutral" className="text-label-caps">
              {analyzers.length} Total
            </Badge>
            <Badge variant="info" className="text-label-caps">
              Read-only catalog
            </Badge>
          </div>
          <p className="max-w-3xl text-body-md text-muted-foreground">
            Browse analyzer metadata exposed by <code className="rounded bg-muted px-1">GET /analyzers</code>{" "}
            and see which business processes currently reference each model.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Catalog size"
            value={analyzers.length}
            caption={analyzers.length === 1 ? "analyzer returned" : "analyzers returned"}
          />
          <KpiCard
            label="Connected models"
            value={connectedAnalyzerCount}
            caption={`${unassignedAnalyzerCount} without process links`}
          />
          <KpiCard
            label="Prebuilt models"
            value={prebuiltCount}
            caption={`${customCount} custom models`}
          />
          <KpiCard
            label="Process references"
            value={processes.reduce((total, process) => total + process.allowedAnalyzerIds.length, 0)}
            caption="allowed analyzer mappings"
          />
        </div>

        <Card className="border-dashed bg-muted/20">
          <CardContent>
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-info-surface text-info">
                <Icon name="info" size={18} />
              </div>
              <div className="space-y-1">
                <p className="font-heading text-sm font-semibold text-foreground">
                  Authoring actions are intentionally omitted
                </p>
                <p className="text-sm text-muted-foreground">
                  The mockup includes training and studio actions, but this screen is read-only because
                  the current backend exposes no analyzer authoring or training API.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {analyzers.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-10 text-center">
            <h2 className="text-headline-md text-foreground">No form models found</h2>
            <p className="mx-auto mt-3 max-w-2xl text-body-md text-muted-foreground">
              <code className="rounded bg-muted px-1">GET /analyzers</code> returned an empty catalog, so
              there are no models to display yet.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border bg-card p-gutter">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative min-w-0 flex-1">
                  <Icon
                    name="search"
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-10"
                    placeholder="Search by model ID, name, description, or connected process..."
                    aria-label="Search form models"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="model-kind-filter">
                    Filter by model type
                  </label>
                  <div className="relative">
                    <select
                      id="model-kind-filter"
                      value={kindFilter}
                      onChange={(event) =>
                        setKindFilter(event.target.value as AnalyzerCatalogFilter)
                      }
                      className="h-8 appearance-none rounded-lg border border-input bg-background px-3 py-1 pr-9 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <option value="all">All model types</option>
                      <option value="prebuilt">Prebuilt</option>
                      <option value="custom">Custom</option>
                    </select>
                    <Icon
                      name="expand_more"
                      size={18}
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border bg-card">
              <SectionHeader
                title="Model catalog"
                description="Analyzer metadata from the API plus process usage derived from allowed analyzer IDs."
                className="border-b px-gutter py-3"
              />
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-gutter text-label-caps text-muted-foreground">
                      Model definition
                    </TableHead>
                    <TableHead className="px-gutter text-label-caps text-muted-foreground">
                      Type
                    </TableHead>
                    <TableHead className="px-gutter text-label-caps text-muted-foreground">
                      Field schema
                    </TableHead>
                    <TableHead className="px-gutter text-label-caps text-muted-foreground">
                      Baseline confidence
                    </TableHead>
                    <TableHead className="px-gutter text-label-caps text-muted-foreground">
                      Connected processes
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(
                    ({
                      analyzer,
                      connectedProcesses,
                      fieldSchemaCount,
                      baselineConfidencePercent,
                    }) => (
                      <TableRow key={analyzer.id} className="align-top">
                        <TableCell className="max-w-md px-gutter py-3 whitespace-normal">
                          <div className="flex items-start gap-2">
                            <div className="bg-muted text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                              <Icon
                                name={analyzer.kind === "prebuilt" ? "verified" : "schema"}
                                size={18}
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="font-heading text-sm font-semibold text-foreground">
                                {analyzer.name}
                              </p>
                              <p className="mt-1 font-mono text-xs text-muted-foreground">
                                {analyzer.id}
                              </p>
                              {analyzer.description ? (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  {analyzer.description}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-gutter py-3">
                          <Badge
                            variant={analyzer.kind === "prebuilt" ? "success" : "outline"}
                            className="text-label-caps"
                          >
                            {formatCatalogKind(analyzer.kind)}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-gutter py-3 whitespace-normal">
                          {fieldSchemaCount === null ? (
                            <div className="space-y-1">
                              <p className="text-sm text-foreground">Not exposed</p>
                              <p className="text-xs text-muted-foreground">
                                <code className="rounded bg-muted px-1">/analyzers</code> does not
                                currently return field schema metadata.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <Badge variant="neutral" className="tabular-figures">
                                {fieldSchemaCount} {fieldSchemaCount === 1 ? "field" : "fields"}
                              </Badge>
                              <p className="text-xs text-muted-foreground">
                                Counted from runtime schema metadata returned by the analyzer record.
                              </p>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="px-gutter py-3 whitespace-normal">
                          {baselineConfidencePercent === null ? (
                            <div className="space-y-1">
                              <p className="text-sm text-foreground">Not exposed</p>
                              <p className="text-xs text-muted-foreground">
                                No baseline confidence field is defined in the generated analyzer schema.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <ConfidenceBadge
                                value={baselineConfidencePercent / 100}
                                showLabel
                              />
                              <p className="text-xs text-muted-foreground">
                                Surfaced from runtime analyzer metadata.
                              </p>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-sm px-gutter py-3 whitespace-normal">
                          <ConnectedProcessLinks
                            analyzerId={analyzer.id}
                            processes={connectedProcesses}
                          />
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
              {filteredRows.length === 0 ? (
                <div className="border-t px-gutter py-8 text-center">
                  <p className="font-heading text-sm font-semibold text-foreground">
                    No form models match these filters.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Adjust the search term or model type filter.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 border-t px-gutter py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing {filteredRows.length} of {analyzers.length} models
                </span>
                <span className="tabular-figures">
                  Connected processes:{" "}
                  {filteredRows.reduce(
                    (total, row) => total + row.connectedProcesses.length,
                    0,
                  )}
                </span>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
