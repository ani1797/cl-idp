"use client";

import dynamic from "next/dynamic";

import { PageLoadingState } from "@/components/page-loading-state";

const InferenceReviewPage = dynamic(
  () => import("@/components/inference-review-page").then((module) => module.InferenceReviewPage),
  {
    ssr: false,
    loading: () => (
      <PageLoadingState
        title="Loading inference review"
        description="Preparing the client-side review workspace."
      />
    ),
  },
);

export function InferenceReviewPageClient({
  processId,
  jobId,
}: {
  processId: string;
  jobId: string;
}) {
  return <InferenceReviewPage processId={processId} jobId={jobId} />;
}
