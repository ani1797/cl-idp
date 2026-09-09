"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";

const exampleFormSchema = z.object({
  displayName: z.string().min(2, "Display name must be at least 2 characters."),
  notificationEmail: z.email("Enter a valid email address."),
  notes: z
    .string()
    .max(140, "Notes must stay under 140 characters.")
    .optional()
    .or(z.literal("")),
});

type ExampleFormValues = z.infer<typeof exampleFormSchema>;

const inputClassName =
  "flex min-h-10 w-full rounded-xl border bg-background px-3 py-2 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ExamplePatternForm() {
  const form = useForm<ExampleFormValues>({
    resolver: zodResolver(exampleFormSchema),
    defaultValues: {
      displayName: "",
      notificationEmail: "",
      notes: "",
    },
  });

  const onSubmit = (values: ExampleFormValues) => {
    toast.success("Form pattern ready", {
      description: `Validated locally for ${values.displayName}. Task 10 will replace this with the real onboarding form.`,
    });
  };

  return (
    <section className="rounded-3xl border bg-background p-6 shadow-sm">
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Form pattern
          </p>
          <h2 className="text-xl font-semibold tracking-tight">react-hook-form + Zod example</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            This throwaway example proves the validation pattern that Task 10 will reuse.
          </p>
        </div>

        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="displayName">
              Display name
            </label>
            <input id="displayName" className={inputClassName} {...form.register("displayName")} />
            {form.formState.errors.displayName ? (
              <p className="text-sm text-destructive">{form.formState.errors.displayName.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="notificationEmail">
              Notification email
            </label>
            <input
              id="notificationEmail"
              type="email"
              className={inputClassName}
              {...form.register("notificationEmail")}
            />
            {form.formState.errors.notificationEmail ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.notificationEmail.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="notes">
              Notes
            </label>
            <textarea id="notes" rows={4} className={inputClassName} {...form.register("notes")} />
            {form.formState.errors.notes ? (
              <p className="text-sm text-destructive">{form.formState.errors.notes.message}</p>
            ) : null}
          </div>

          <Button type="submit">Validate example form</Button>
        </form>
      </div>
    </section>
  );
}
