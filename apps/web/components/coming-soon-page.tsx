import { ApiErrorDemo } from "@/components/example-api-error-demo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

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
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardContent>
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="rocket_launch" size={32} />
            </div>
            <div className="space-y-3">
              <p className="text-label-caps text-muted-foreground">{pageId}</p>
              <h1 className="text-headline-md text-balance text-card-foreground">{title}</h1>
              <p className="mx-auto max-w-2xl text-body-md text-muted-foreground">{description}</p>
            </div>
            <div className="grid w-full max-w-2xl gap-4 text-left md:grid-cols-2">
              <Card size="sm" className="bg-muted/30">
                <CardContent>
                  <div className="flex items-start gap-3">
                    <Icon name="link" size={20} className="mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-card-foreground">Route stub</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Route <code className="rounded bg-muted px-1.5 py-0.5">{routePath}</code> resolves now so
                        feature tasks can land incrementally.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card size="sm" className="bg-muted/30">
                <CardContent>
                  <div className="flex items-start gap-3">
                    <Icon name="hub" size={20} className="mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-card-foreground">Shared infrastructure</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        TanStack Query, typed API helpers, loading states, and error surfacing are ready for reuse.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Button type="button" disabled>
              Screen implementation pending
            </Button>
            <p className="max-w-xl text-sm text-muted-foreground">
              This page is intentionally stubbed in Task 09. Screen-specific logic arrives in later tasks.
            </p>
          </div>
        </CardContent>
      </Card>

      <aside className="space-y-6">
        {aside}
        <ApiErrorDemo />
      </aside>
    </div>
  );
}
