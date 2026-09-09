"use client";

import { Button } from "@/components/ui/button";
import { showErrorToast } from "@/lib/errors";

export function ApiErrorDemo() {
  return (
    <section className="rounded-3xl border bg-background p-6 shadow-sm">
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Error pattern
          </p>
          <h2 className="text-xl font-semibold tracking-tight">Shared API error toast</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Screens can surface the API contract&apos;s <code>Error.message</code> consistently with one helper.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            showErrorToast({
              code: "demo_error",
              message: "Simulated API error from the shared error schema.",
              details: { source: "task-09-demo" },
            })
          }
        >
          Preview API error toast
        </Button>
      </div>
    </section>
  );
}
