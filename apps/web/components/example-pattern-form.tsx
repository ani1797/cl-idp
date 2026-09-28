"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm";

function FieldError({ message }: { message?: string }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-destructive">
      <Icon name="error" size={16} className="mt-0.5" />
      <span>{message ?? "Invalid value."}</span>
    </p>
  );
}

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
    <Card>
      <CardContent>
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-label-caps text-muted-foreground">Form pattern</p>
            <h2 className="text-headline-md text-card-foreground">react-hook-form + Zod example</h2>
            <p className="text-body-md text-muted-foreground">
              This throwaway example proves the validation pattern that Task 10 will reuse.
            </p>
          </div>

          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                aria-invalid={Boolean(form.formState.errors.displayName)}
                {...form.register("displayName")}
              />
              {form.formState.errors.displayName ? (
                <FieldError message={form.formState.errors.displayName.message} />
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notificationEmail">Notification email</Label>
              <Input
                id="notificationEmail"
                type="email"
                aria-invalid={Boolean(form.formState.errors.notificationEmail)}
                {...form.register("notificationEmail")}
              />
              {form.formState.errors.notificationEmail ? (
                <FieldError message={form.formState.errors.notificationEmail.message} />
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                rows={4}
                className={cn(inputClassName)}
                aria-invalid={Boolean(form.formState.errors.notes)}
                {...form.register("notes")}
              />
              {form.formState.errors.notes ? (
                <FieldError message={form.formState.errors.notes.message} />
              ) : null}
            </div>

            <Button type="submit">Validate example form</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
