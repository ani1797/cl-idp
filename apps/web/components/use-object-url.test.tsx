import { StrictMode, type ReactNode } from "react";

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useObjectUrl } from "@/lib/use-object-url";

describe("useObjectUrl", () => {
  const createObjectURL = vi.fn<(blob: Blob) => string>();
  const revokeObjectURL = vi.fn<(url: string) => void>();

  beforeEach(() => {
    createObjectURL.mockReset();
    revokeObjectURL.mockReset();

    createObjectURL
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second")
      .mockReturnValue("blob:extra");

    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the same object URL for equivalent blob refetches and only revokes after the last unmount", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const firstBlob = new Blob(["same-bytes"], { type: "application/pdf" });

    const { result, rerender, unmount } = renderHook(
      ({ blob, documentIdentity }) => useObjectUrl(blob, documentIdentity),
      {
        initialProps: {
          blob: firstBlob,
          documentIdentity: "job-1",
        },
        wrapper,
      },
    );

    expect(result.current).toBe("blob:first");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    rerender({
      blob: new Blob(["same-bytes"], { type: "application/pdf" }),
      documentIdentity: "job-1",
    });

    expect(result.current).toBe("blob:first");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    rerender({
      blob: new Blob(["different-bytes"], { type: "application/pdf" }),
      documentIdentity: "job-2",
    });

    expect(result.current).toBe("blob:second");
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    await vi.waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    });
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:first");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:second");
  });
});
