"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { SectionHeader } from "@/components/brand/primitives";
import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  api,
  ApiError,
  type Analyzer,
  type BusinessProcess,
  type BusinessProcessInput,
} from "@/lib/api";
import { getErrorMessage, showErrorToast } from "@/lib/errors";
import {
  confidenceThresholdFloatToPercent,
  confidenceThresholdPercentToFloat,
} from "@/lib/process-threshold";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const EMPTY_ANALYZER_IDS: string[] = [];

const processFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  description: z.string().trim().min(1, "Description is required."),
  allowedAnalyzerIds: z
    .array(z.string())
    .min(1, "Select at least one analyzer.")
    .max(199, "You can select up to 199 analyzers.")
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate analyzers are not allowed.")
    .refine((ids) => !ids.includes("other"), "The reserved analyzer ID 'other' cannot be selected."),
  confidenceThresholdPercent: z
    .number({ error: "Average Confidence threshold is required." })
    .min(0, "Average Confidence threshold must be between 0 and 100.")
    .max(100, "Average Confidence threshold must be between 0 and 100."),
  ownerEmail: z
    .string()
    .trim()
    .min(1, "Business owner email is required.")
    .email("Enter a valid email address."),
});

type ProcessFormValues = z.infer<typeof processFormSchema>;

type ProcessFormProps =
  | {
    mode: "create";
    processId?: never;
  }
  | {
    mode: "edit";
    processId: string;
  };

function buildDefaultValues(): ProcessFormValues {
  return {
    name: "",
    description: "",
    allowedAnalyzerIds: [],
    confidenceThresholdPercent: 85,
    ownerEmail: "",
  };
}

function mapProcessToFormValues(process: BusinessProcess): ProcessFormValues {
  return {
    name: process.name,
    description: process.description,
    allowedAnalyzerIds: process.allowedAnalyzerIds,
    confidenceThresholdPercent: confidenceThresholdFloatToPercent(process.confidenceThreshold),
    ownerEmail: process.ownerEmail,
  };
}

function buildProcessInput(values: ProcessFormValues): BusinessProcessInput {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    allowedAnalyzerIds: values.allowedAnalyzerIds,
    confidenceThreshold: confidenceThresholdPercentToFloat(values.confidenceThresholdPercent),
    ownerEmail: values.ownerEmail.trim(),
  };
}

function AnalyzerErrorMessage({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
      <span>{getErrorMessage(error)}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function StaleAnalyzerChip({ analyzerId, onRemove }: { analyzerId: string; onRemove: () => void }) {
  return (
    <div className="rounded-lg border border-warning-border bg-warning-surface p-3 text-sm text-warning-foreground">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Unavailable analyzer: {analyzerId}</p>
          <p className="mt-1 text-xs leading-5 text-warning-foreground/80">
            This analyzer is no longer available and will be removed if you save.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove stale analyzer ${analyzerId}`}
          onClick={onRemove}
        >
          <Icon name="close" className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function ProcessForm(props: ProcessFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<ProcessFormValues>({
    resolver: zodResolver(processFormSchema),
    defaultValues: buildDefaultValues(),
  });

  const editableProcessId = props.mode === "edit" ? props.processId : null;

  const processQuery = useQuery({
    queryKey: editableProcessId
      ? queryKeys.processes.detail(editableProcessId)
      : ["process-form", "create"],
    queryFn: async () => {
      if (!editableProcessId) {
        throw new Error("Process ID is required for edit mode.");
      }

      return api.getProcess(editableProcessId);
    },
    enabled: editableProcessId !== null,
  });

  const analyzersQuery = useQuery({
    queryKey: queryKeys.analyzers,
    queryFn: api.listAnalyzers,
  });

  useEffect(() => {
    if (props.mode === "edit" && processQuery.data) {
      form.reset(mapProcessToFormValues(processQuery.data));
    }
  }, [form, processQuery.data, props.mode]);

  const availableAnalyzerIds = useMemo(
    () => new Set((analyzersQuery.data ?? []).map((analyzer) => analyzer.id)),
    [analyzersQuery.data],
  );

  const selectedAnalyzerIds = useWatch({
    control: form.control,
    name: "allowedAnalyzerIds",
  });
  const normalizedSelectedAnalyzerIds = selectedAnalyzerIds ?? EMPTY_ANALYZER_IDS;
  const confidenceThresholdPercent = useWatch({
    control: form.control,
    name: "confidenceThresholdPercent",
  });
  const sliderThresholdValue =
    typeof confidenceThresholdPercent === "number" && Number.isFinite(confidenceThresholdPercent)
      ? Math.min(100, Math.max(0, confidenceThresholdPercent))
      : 0;

  const staleAnalyzerIds = useMemo(
    () =>
      props.mode === "edit" && analyzersQuery.data
        ? normalizedSelectedAnalyzerIds.filter((analyzerId) => !availableAnalyzerIds.has(analyzerId))
        : [],
    [analyzersQuery.data, availableAnalyzerIds, normalizedSelectedAnalyzerIds, props.mode],
  );

  const saveMutation = useMutation({
    mutationFn: async (values: ProcessFormValues) => {
      const payload = buildProcessInput(values);
      return props.mode === "create"
        ? api.createProcess(payload)
        : api.updateProcess(props.processId, payload);
    },
    onSuccess: (process) => {
      queryClient.setQueryData<BusinessProcess[]>(queryKeys.processes.all, (current) => {
        if (!current) {
          return current;
        }

        const existingIndex = current.findIndex((item) => item.id === process.id);
        if (existingIndex === -1) {
          return [process, ...current];
        }

        const next = [...current];
        next[existingIndex] = process;
        return next;
      });
      queryClient.setQueryData(queryKeys.processes.detail(process.id), process);
      void queryClient.invalidateQueries({ queryKey: queryKeys.processes.all });
      router.push(`/processes/${process.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        form.setError("name", {
          type: "server",
          message: "Name already in use.",
        });
        return;
      }

      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        showErrorToast(error, "Unable to save process");
        return;
      }

      showErrorToast(error, "Unable to save process");
    },
  });

  if (props.mode === "edit" && processQuery.isLoading) {
    return (
      <PageLoadingState
        title="Loading business process"
        description="Fetching the saved process configuration for editing."
      />
    );
  }

  if (props.mode === "edit" && processQuery.isError) {
    return (
      <div className="w-full">
        <ErrorCard
          title="Could not load process"
          message="The process could not be loaded for editing. Please try again."
          onRetry={() => void processQuery.refetch()}
        />
      </div>
    );
  }

  const analyzers = analyzersQuery.data ?? [];
  const analyzersUnavailable = analyzersQuery.isError;

  return (
    <div className="w-full">
      <form
        noValidate
        className="space-y-margin"
        onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
      >
        <Card>
          <CardHeader className="border-b pb-4">
            <SectionHeader
              title={props.mode === "create" ? "New business process" : "Update business process"}
              description="Configure the analyzer set, average confidence threshold, and business owner email for this Enterprise IDP workflow."
              actions={
                <span className="text-label-caps rounded-full border bg-muted px-2.5 py-1 text-muted-foreground">
                  {props.mode === "create" ? "Create process" : "Edit process"}
                </span>
              }
            />
          </CardHeader>
          <CardContent className="grid gap-gutter pt-0 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name" className="text-label-caps text-foreground">
                Name
              </Label>
              <Input
                id="name"
                type="text"
                aria-invalid={form.formState.errors.name ? "true" : "false"}
                {...form.register("name")}
              />
              <p className="text-sm text-muted-foreground">
                Human-readable process name displayed in review and operations workspaces.
              </p>
              {form.formState.errors.name ? (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              ) : null}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description" className="text-label-caps text-foreground">
                Description
              </Label>
              <textarea
                id="description"
                rows={4}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
                aria-invalid={form.formState.errors.description ? "true" : "false"}
                {...form.register("description")}
              />
              <p className="text-sm text-muted-foreground">
                Summarize what documents this process routes and why reviewers use it.
              </p>
              {form.formState.errors.description ? (
                <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <SectionHeader
              title="Attached analyzer models"
              description="Select one or more Content Understanding analyzers for this process."
              actions={
                <span className="text-label-caps rounded-full bg-secondary/10 px-2.5 py-1 text-secondary">
                  {normalizedSelectedAnalyzerIds.length} selected
                </span>
              }
            />
          </CardHeader>
          <CardContent className="space-y-gutter pt-0">
            {staleAnalyzerIds.length > 0 ? (
              <div className="space-y-3">
                {staleAnalyzerIds.map((analyzerId) => (
                  <StaleAnalyzerChip
                    key={analyzerId}
                    analyzerId={analyzerId}
                    onRemove={() => {
                      form.setValue(
                        "allowedAnalyzerIds",
                        normalizedSelectedAnalyzerIds.filter((id) => id !== analyzerId),
                        { shouldDirty: true, shouldValidate: true },
                      );
                    }}
                  />
                ))}
              </div>
            ) : null}

            {analyzersQuery.isLoading ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Loading analyzers…
              </div>
            ) : null}

            {analyzersUnavailable ? (
              <AnalyzerErrorMessage
                error={analyzersQuery.error}
                onRetry={() => void analyzersQuery.refetch()}
              />
            ) : null}

            {!analyzersQuery.isLoading && !analyzersUnavailable ? (
              <div className="grid gap-3">
                {analyzers.map((analyzer: Analyzer) => {
                  const checked = normalizedSelectedAnalyzerIds.includes(analyzer.id);
                  const checkboxId = `analyzer-${analyzer.id}`;
                  return (
                    <div
                      key={analyzer.id}
                      className={cn(
                        "group/field rounded-lg border p-gutter transition-colors",
                        checked ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={checkboxId}
                          className="mt-1"
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            const next =
                              nextChecked === true
                                ? [...normalizedSelectedAnalyzerIds, analyzer.id]
                                : normalizedSelectedAnalyzerIds.filter((id) => id !== analyzer.id);
                            form.setValue("allowedAnalyzerIds", next, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }}
                        />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Label htmlFor={checkboxId} className="font-medium leading-5">
                              {analyzer.name}
                            </Label>
                            <span className="text-label-caps rounded-full border px-2 py-0.5 text-muted-foreground">
                              {analyzer.kind}
                            </span>
                          </div>
                          {analyzer.description ? (
                            <p className="text-sm leading-6 text-muted-foreground">
                              {analyzer.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {form.formState.errors.allowedAnalyzerIds ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.allowedAnalyzerIds.message}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-margin lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.6fr)]">
          <Card>
            <CardHeader className="border-b pb-4">
              <SectionHeader
                title="Confidence routing threshold"
                description="Set the average document confidence required before straight-through processing."
              />
            </CardHeader>
            <CardContent className="space-y-gutter pt-0">
              <div className="rounded-lg border bg-muted/40 p-gutter">
                <div className="flex flex-wrap items-start justify-between gap-gutter">
                  <div className="space-y-1">
                    <Label
                      htmlFor="confidenceThresholdPercent"
                      className="text-label-caps text-foreground"
                    >
                      Average Confidence threshold (%)
                    </Label>
                    <p className="max-w-xl text-sm text-muted-foreground">
                      Documents below this cutoff are routed to Human-In-The-Loop review.
                    </p>
                  </div>
                  <Input
                    id="confidenceThresholdPercent"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    className="w-28 text-right tabular-figures"
                    aria-invalid={
                      form.formState.errors.confidenceThresholdPercent ? "true" : "false"
                    }
                    {...form.register("confidenceThresholdPercent", {
                      setValueAs: (value) => (value === "" ? undefined : Number(value)),
                    })}
                  />
                </div>
                <div className="mt-gutter space-y-3">
                  <Slider
                    aria-label="Average Confidence threshold slider"
                    min={0}
                    max={100}
                    step={0.01}
                    value={[sliderThresholdValue]}
                    onValueChange={([nextValue]) => {
                      form.setValue("confidenceThresholdPercent", nextValue ?? 0, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                    className="[&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-secondary [&_[data-slot=slider-thumb]]:bg-secondary [&_[data-slot=slider-thumb]]:ring-secondary/30"
                  />
                  <div className="text-label-caps flex justify-between text-muted-foreground">
                    <span>Route all</span>
                    <span className="text-secondary">Recommended baseline</span>
                    <span>Strict STP</span>
                  </div>
                </div>
              </div>
              {form.formState.errors.confidenceThresholdPercent ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.confidenceThresholdPercent.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b pb-4">
              <SectionHeader
                title="Governance owner"
                description="Assign the business accountable owner for audit and escalation."
              />
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Label htmlFor="ownerEmail" className="text-label-caps text-foreground">
                Business owner email
              </Label>
              <Input
                id="ownerEmail"
                type="email"
                aria-invalid={form.formState.errors.ownerEmail ? "true" : "false"}
                {...form.register("ownerEmail")}
              />
              <p className="text-sm text-muted-foreground">
                Used for exception routing, audit contacts, and operational notifications.
              </p>
              {form.formState.errors.ownerEmail ? (
                <p className="text-sm text-destructive">{form.formState.errors.ownerEmail.message}</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="sticky bottom-0 z-10 -mx-margin border-t bg-card/95 px-margin py-gutter shadow-md backdrop-blur supports-[backdrop-filter]:bg-card/90">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" asChild>
              <Link href="/">Cancel</Link>
            </Button>
            <Button
              type="submit"
              aria-busy={saveMutation.isPending}
              disabled={saveMutation.isPending || analyzersQuery.isLoading || analyzersUnavailable}
            >
              Save
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

export { buildProcessInput, mapProcessToFormValues, processFormSchema };
