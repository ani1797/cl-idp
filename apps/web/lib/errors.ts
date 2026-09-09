import { toast } from "sonner";

import { ApiError, type ApiErrorBody } from "@/lib/api";

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.body?.message ?? error.message;
  }

  if (isApiErrorBody(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred.";
}

export function showErrorToast(error: unknown, title = "Request failed") {
  return toast.error(title, {
    description: getErrorMessage(error),
  });
}
