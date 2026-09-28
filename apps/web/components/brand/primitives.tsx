import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type DeploymentEnvironment = "production" | "sandbox";

/**
 * Solid maroon for PRODUCTION, outlined neutral for SANDBOX, per the design
 * system's environment badge rules.
 */
export function EnvironmentBadge({
  environment = "production",
  healthy = true,
  className,
}: {
  environment?: DeploymentEnvironment;
  healthy?: boolean;
  className?: string;
}) {
  const isProduction = environment === "production";

  return (
    <span
      className={cn(
        "text-label-caps inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        isProduction
          ? "bg-primary text-primary-foreground border-transparent"
          : "border-border text-muted-foreground bg-transparent",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          healthy ? "bg-brand-teal" : "bg-warning",
          isProduction && healthy && "bg-brand-teal-light",
        )}
      />
      <span>
        {isProduction ? "Production" : "Sandbox"}
        {healthy ? "" : " • Degraded"}
      </span>
    </span>
  );
}

/**
 * Compact KPI tile used across the dashboard and list headers.
 */
export function KpiCard({
  label,
  value,
  caption,
  trend,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  trend?: { direction: "up" | "down"; label: string; positive?: boolean };
  className?: string;
}) {
  return (
    <div className={cn("bg-card rounded-lg border p-4", className)}>
      <p className="text-label-caps text-muted-foreground">{label}</p>
      <p className="font-heading tabular-figures text-foreground mt-2 text-2xl font-semibold">
        {value}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              trend.positive === false ? "text-destructive" : "text-success",
            )}
          >
            <Icon
              name={trend.direction === "up" ? "trending_up" : "trending_down"}
              size={14}
            />
            {trend.label}
          </span>
        ) : null}
        {caption ? <span className="text-muted-foreground text-xs">{caption}</span> : null}
      </div>
    </div>
  );
}

/**
 * Section heading with an optional action slot, matching the design's
 * content-block rhythm.
 */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="font-heading text-headline-md text-foreground">{title}</h2>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
