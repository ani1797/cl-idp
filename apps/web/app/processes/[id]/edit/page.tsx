import { ProcessForm } from "@/components/process-form";

export default async function EditProcessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ProcessForm mode="edit" processId={id} />;
}
