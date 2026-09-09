"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { ErrorCard } from "@/components/error-card";
import { PageLoadingState } from "@/components/page-loading-state";
import { Button } from "@/components/ui/button";
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
    .number({ error: "Confidence threshold is required." })
    .min(0, "Confidence threshold must be between 0 and 100.")
    .max(100, "Confidence threshold must be between 0 and 100."),
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

function AnalyzerErrorMessage({ error }: { error: unknown }) {
  return (
    <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
      {getErrorMessage(error)}
    </div>
  );
}

function StaleAnalyzerChip({ analyzerId, onRemove }: { analyzerId: string; onRemove: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Unavailable analyzer: {analyzerId}</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
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
          <X className="size-4" />
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
      <div className="mx-auto w-full max-w-5xl">
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
    <div className="mx-auto w-full max-w-5xl">
      <section className="rounded-3xl border bg-background p-8 shadow-sm">
        <div className="space-y-2 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {props.mode === "create" ? "Create process" : "Edit process"}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {props.mode === "create" ? "New business process" : "Update business process"}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Configure the analyzer set, confidence threshold, and business owner email for this
            Enterprise IDP workflow.
          </p>
        </div>

        <form
          noValidate
          className="mt-8 space-y-8"
          onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                type="text"
                className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
                aria-invalid={form.formState.errors.name ? "true" : "false"}
                {...form.register("name")}
              />
              {form.formState.errors.name ? (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              ) : null}
            </div>

            <div className="space-y-2 md:col-span-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <textarea
                id="description"
                rows={4}
                className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
                aria-invalid={form.formState.errors.description ? "true" : "false"}
                {...form.register("description")}
              />
              {form.formState.errors.description ? (
                <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>
              ) : null}
            </div>

            <div className="space-y-3 md:col-span-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Allowed analyzers</label>
                <p className="text-sm text-muted-foreground">
                  Select one or more Content Understanding analyzers for this process.
                </p>
              </div>

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
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  Loading analyzers…
                </div>
              ) : null}

              {analyzersUnavailable ? <AnalyzerErrorMessage error={analyzersQuery.error} /> : null}

              {!analyzersQuery.isLoading && !analyzersUnavailable ? (
                <div className="grid gap-3">
                  {analyzers.map((analyzer: Analyzer) => {
                    const checked = normalizedSelectedAnalyzerIds.includes(analyzer.id);
                    return (
                      <label
                        key={analyzer.id}
                        className={cn(
                          "flex items-start gap-3 rounded-2xl border p-4",
                          checked ? "border-primary bg-primary/5" : "bg-background",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...normalizedSelectedAnalyzerIds, analyzer.id]
                              : normalizedSelectedAnalyzerIds.filter((id) => id !== analyzer.id);
                            form.setValue("allowedAnalyzerIds", next, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }}
                        />
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{analyzer.name}</span>
                            <span className="rounded-full border px-2 py-0.5 text-xs capitalize text-muted-foreground">
                              {analyzer.kind}
                            </span>
                          </div>
                          {analyzer.description ? (
                            <p className="text-sm leading-6 text-muted-foreground">
                              {analyzer.description}
                            </p>
                          ) : null}
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {form.formState.errors.allowedAnalyzerIds ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.allowedAnalyzerIds.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="confidenceThresholdPercent" className="text-sm font-medium">
                Confidence threshold (%)
              </label>
              <input
                id="confidenceThresholdPercent"
                type="number"
                min={0}
                max={100}
                step={0.01}
                className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
                aria-invalid={form.formState.errors.confidenceThresholdPercent ? "true" : "false"}
                {...form.register("confidenceThresholdPercent", {
                  setValueAs: (value) => (value === "" ? undefined : Number(value)),
                })}
              />
              {form.formState.errors.confidenceThresholdPercent ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.confidenceThresholdPercent.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="ownerEmail" className="text-sm font-medium">
                Business owner email
              </label>
              <input
                id="ownerEmail"
                type="email"
                className="w-full rounded-2xl border bg-background px-3 py-2 text-sm"
                aria-invalid={form.formState.errors.ownerEmail ? "true" : "false"}
                {...form.register("ownerEmail")}
              />
              {form.formState.errors.ownerEmail ? (
                <p className="text-sm text-destructive">{form.formState.errors.ownerEmail.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t pt-6">
            <Button variant="outline" asChild>
              <Link href="/">Cancel</Link>
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending || analyzersQuery.isLoading || analyzersUnavailable}
            >
              {saveMutation.isPending ? "Saving…" : "Save process"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export { buildProcessInput, mapProcessToFormValues, processFormSchema };
