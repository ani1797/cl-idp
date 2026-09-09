import { InferenceReviewPageClient } from "@/components/inference-review-page-client";

export default async function JobReviewPage({
  params,
}: {
  params: Promise<{ id: string; jobId: string }>;
}) {
  const { id, jobId } = await params;

  return <InferenceReviewPageClient processId={id} jobId={jobId} />;
}
