import { ProcessDetailPage } from "@/components/process-detail-page";

export default async function ProcessDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProcessDetailPage processId={id} />;
}
