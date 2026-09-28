import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

export function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="w-full max-w-xl border-destructive/30 bg-card">
      <CardContent>
        <div className="space-y-5">
          <div className="flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Icon name="error" size={24} />
            </div>
            <div className="space-y-2">
              <p className="text-label-caps text-destructive">Error</p>
              <h1 className="text-headline-md text-card-foreground">{title}</h1>
              <p className="text-body-md text-muted-foreground">{message}</p>
            </div>
          </div>
          {onRetry ? (
            <Button type="button" variant="destructive" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
