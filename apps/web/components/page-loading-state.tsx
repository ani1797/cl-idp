import { Skeleton } from "@/components/ui/skeleton";

export function PageLoadingState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-3xl border bg-background p-8 shadow-sm">
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-5 w-full max-w-2xl" />
            <Skeleton className="h-5 w-full max-w-xl" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
          <div className="rounded-2xl border border-dashed p-6">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <Skeleton className="h-80 rounded-3xl" />
        <Skeleton className="h-52 rounded-3xl" />
      </aside>
    </div>
  );
}
