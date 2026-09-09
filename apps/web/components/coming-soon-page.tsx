import { ApiErrorDemo } from "@/components/example-api-error-demo";
import { Button } from "@/components/ui/button";

export function ComingSoonPage({
  title,
  description,
  pageId,
  routePath,
  aside,
}: {
  title: string;
  description: string;
  pageId: string;
  routePath: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-3xl border bg-background p-8 shadow-sm">
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {pageId}
            </p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-balance">
                {title}
              </h1>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                {description}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border bg-muted/40 p-5">
              <p className="text-sm font-medium text-foreground">Route stub</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Route <code className="rounded bg-muted px-1.5 py-0.5">{routePath}</code> resolves now so
                feature tasks can land incrementally.
              </p>
            </div>
            <div className="rounded-2xl border bg-muted/40 p-5">
              <p className="text-sm font-medium text-foreground">Shared infrastructure</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                TanStack Query, typed API helpers, loading states, and error surfacing are ready for reuse.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-dashed bg-muted/20 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Coming soon</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  This page is intentionally stubbed in Task 09. Screen-specific logic arrives in later tasks.
                </p>
              </div>
              <Button type="button" variant="outline" disabled>
                Screen implementation pending
              </Button>
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        {aside}
        <ApiErrorDemo />
      </aside>
    </div>
  );
}
