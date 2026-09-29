import { SectionHeader } from "@/components/brand/primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const ERROR_ITEMS = [
  {
    status: 400,
    label: "Invalid upload",
    description:
      "Trigger requests reject unsupported file types, oversized uploads, unreadable documents, too many pages, or anything other than exactly one file.",
  },
  {
    status: 401,
    label: "Unauthorized",
    description:
      "Returned when authentication is missing, invalid, or a user tries to mint a token with the wrong email/password.",
  },
  {
    status: 403,
    label: "Role not permitted",
    description:
      "Retrying failed jobs is limited to IT Admin and Reviewer roles for user-bound callers; trusted service-token automation is exempt.",
  },
  {
    status: 404,
    label: "Not found",
    description:
      "Processes and jobs return 404 when the supplied processId or jobId does not exist for that route.",
  },
  {
    status: 409,
    label: "Conflict",
    description:
      "Trigger and retry return 409 while the routing analyzer is not ready, and retry also returns 409 when the chosen job is not failed.",
  },
  {
    status: 422,
    label: "Unprocessable",
    description:
      "FastAPI can reject malformed request shapes before the app handler runs, such as invalid multipart or parameter payloads.",
  },
] as const;

export function ErrorsSection() {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Errors to handle"
        description="These are the main non-success responses integrators should account for in real callers."
      />

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">
        {ERROR_ITEMS.map((item) => (
          <Card key={item.status}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center gap-2">
                <Badge variant={item.status >= 500 ? "destructive" : "warning"}>{item.status}</Badge>
                <p className="font-medium text-foreground">{item.label}</p>
              </div>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
