import { cn } from "@/lib/utils";

/**
 * Canada Life IDP logo lockup, drawn in code so there is no binary brand
 * asset in the repo. `tone` selects the treatment for light chrome vs. a
 * brand-coloured band.
 */
export function Wordmark({
  tone = "brand",
  showTagline = true,
  className,
}: {
  tone?: "brand" | "inverse";
  showTagline?: boolean;
  className?: string;
}) {
  const inverse = tone === "inverse";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "text-label-caps flex size-8 shrink-0 items-center justify-center rounded-lg",
          inverse ? "text-primary bg-white" : "bg-primary text-primary-foreground",
        )}
      >
        CL
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span
          className={cn(
            "font-heading truncate text-sm font-bold tracking-tight",
            inverse ? "text-white" : "text-foreground",
          )}
        >
          Canada Life
        </span>
        {showTagline ? (
          <span
            className={cn(
              "text-label-caps mt-0.5 truncate text-[10px]",
              inverse ? "text-white/80" : "text-muted-foreground",
            )}
          >
            Intelligent Document Processing
          </span>
        ) : null}
      </span>
    </span>
  );
}
