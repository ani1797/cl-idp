"use client";

import { useEffect } from "react";

import { ErrorCard } from "@/components/error-card";
import { getErrorMessage, showErrorToast } from "@/lib/errors";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    showErrorToast(error, "Something went wrong");
  }, [error]);

  return (
    <div className="flex w-full justify-center py-12">
      <ErrorCard
        title="Unable to render this page"
        message={getErrorMessage(error)}
        onRetry={reset}
      />
    </div>
  );
}
