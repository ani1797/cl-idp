"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { showErrorToast } from "@/lib/errors";

export function ApiErrorDemo() {
  return (
    <Card>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Icon name="error" size={20} />
            </div>
            <div className="space-y-2">
              <p className="text-label-caps text-muted-foreground">Error pattern</p>
              <h2 className="text-headline-md text-card-foreground">Shared API error toast</h2>
              <p className="text-body-md text-muted-foreground">
                Screens can surface the API contract&apos;s <code>Error.message</code> consistently with one helper.
              </p>
            </div>
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
      </CardContent>
    </Card>
  );
}
