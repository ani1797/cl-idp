import { type ExtractedField, type Job, type ReviewedField } from "@/lib/api";

type ContainerFieldType = ExtractedField["type"] & ("array" | "object");
export type LeafField = ExtractedField & {
  type: Exclude<ExtractedField["type"], ContainerFieldType>;
};

export type OverlayPoint = {
  x: number;
  y: number;
};

export type OverlayBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function isLeafField(field: ExtractedField): field is LeafField {
  return field.type !== "array" && field.type !== "object";
}

export function getFieldChildren(field: ExtractedField) {
  if (field.type === "array") {
    return field.items ?? [];
  }

  if (field.type === "object") {
    return Object.values(field.properties ?? {});
  }

  return [];
}

export function collectLeafFields(fields: ExtractedField[] | undefined): LeafField[] {
  if (!fields) {
    return [];
  }

  return fields.flatMap((field) =>
    isLeafField(field) ? [field] : collectLeafFields(getFieldChildren(field)),
  );
}

export function stringifyFieldValue(value: LeafField["value"] | undefined) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

export function getInitialFieldValue(field: LeafField) {
  return field.reviewedValue ?? stringifyFieldValue(field.value);
}

export function buildReviewPayload({
  fieldsByPath,
  edits,
  approvals,
}: {
  fieldsByPath: Map<string, LeafField>;
  edits: Map<string, string>;
  approvals: Set<string>;
}) {
  const touchedPaths = Array.from(new Set([...approvals, ...edits.keys()]));

  const fields: ReviewedField[] = touchedPaths.map((path) => {
    const field = fieldsByPath.get(path);

    return {
      path,
      value: edits.get(path) ?? (field ? getInitialFieldValue(field) : ""),
    };
  });

  return { fields };
}

export function getFieldLabel(field: ExtractedField) {
  if (/^\d+$/.test(field.name)) {
    return `[${field.name}]`;
  }

  return field.name;
}

export function scaleBoundingBoxPoints(
  boundingBox: number[] | undefined,
  renderedWidth: number,
  renderedHeight: number,
): OverlayPoint[] {
  if (!boundingBox || boundingBox.length !== 8) {
    return [];
  }

  return boundingBox.reduce<OverlayPoint[]>((points, coordinate, index) => {
    if (index % 2 === 0) {
      points.push({
        x: coordinate * renderedWidth,
        y: (boundingBox[index + 1] ?? 0) * renderedHeight,
      });
    }

    return points;
  }, []);
}

export function getOverlayBounds(points: OverlayPoint[]): OverlayBounds | null {
  if (points.length === 0) {
    return null;
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const left = Math.min(...xValues);
  const top = Math.min(...yValues);
  const right = Math.max(...xValues);
  const bottom = Math.max(...yValues);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function getDocumentKind(blob: Blob | undefined, fileName: string) {
  const type = blob?.type.toLowerCase() ?? "";

  if (type.includes("pdf")) {
    return "pdf" as const;
  }

  if (type.startsWith("image/")) {
    return "image" as const;
  }

  return /\.(png|jpe?g)$/i.test(fileName) ? ("image" as const) : ("pdf" as const);
}

export function getReturnHref(processId: string, from: string | null) {
  const fallback = `/processes/${processId}`;

  if (!from) {
    return fallback;
  }

  if (from === fallback || from.startsWith(`/processes/${processId}/jobs`)) {
    return from;
  }

  return fallback;
}

export function isJobInFlight(job: Job | undefined) {
  return job?.status === "queued" || job?.status === "running";
}
