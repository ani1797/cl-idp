import { ProcessJobsPage } from "@/components/process-jobs-page";

export default async function ProcessJobsRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProcessJobsPage processId={id} />;
}
