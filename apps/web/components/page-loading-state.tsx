import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PageLoadingState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true">
      <span className="sr-only">
        {title}: {description}
      </span>
      <Card>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-72 max-w-full" />
              <Skeleton className="h-5 w-full max-w-2xl" />
              <Skeleton className="h-5 w-full max-w-xl" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card size="sm" className="bg-muted/30">
                <CardContent>
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="mt-3 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-3/4" />
                </CardContent>
              </Card>
              <Card size="sm" className="bg-muted/30">
                <CardContent>
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-3 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                </CardContent>
              </Card>
            </div>
            <Card className="border-dashed bg-muted/20">
              <CardContent>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-36" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                  </div>
                  <Skeleton className="h-8 w-52" />
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <aside className="space-y-6">
        <Card>
          <CardContent>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-4 h-32 w-full" />
            <Skeleton className="mt-4 h-8 w-40" />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-4 h-20 w-full" />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
