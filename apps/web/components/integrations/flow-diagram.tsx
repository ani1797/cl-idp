import { FLOW_STEPS } from "@/components/integrations/endpoint-catalog";
import { SectionHeader } from "@/components/brand/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

export function IntegrationFlowDiagram() {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="How an integration works"
        description="The full round trip, start to finish."
      />

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-4">
        {FLOW_STEPS.map((step) => (
          <Card key={step.step}>
            <CardContent className="flex h-full flex-col justify-between p-4">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {step.step}
                  </div>
                  <Icon name={step.icon} size={20} className="text-primary" />
                </div>
                <h3 className="font-medium text-foreground">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
              </div>

              <div className="mt-4 border-t border-border/70 pt-3">
                <span className="inline-flex rounded-md border border-primary/15 bg-primary/5 px-2 py-0.5 font-mono text-[11px] text-primary">
                  {step.method} {step.path}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
