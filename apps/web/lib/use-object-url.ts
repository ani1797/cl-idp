"use client";

import { useEffect, useState } from "react";

type ObjectUrlCacheEntry = {
  url: string;
  refCount: number;
  revokeTimer: ReturnType<typeof setTimeout> | null;
};

const objectUrlCache = new Map<string, ObjectUrlCacheEntry>();

export function useObjectUrl(blob: Blob | undefined, documentIdentity: string | null) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!blob || !documentIdentity) {
      setObjectUrl(null);
      return;
    }

    let cacheEntry = objectUrlCache.get(documentIdentity);

    if (!cacheEntry) {
      cacheEntry = {
        url: URL.createObjectURL(blob),
        refCount: 0,
        revokeTimer: null,
      };
      objectUrlCache.set(documentIdentity, cacheEntry);
    } else if (cacheEntry.revokeTimer) {
      clearTimeout(cacheEntry.revokeTimer);
      cacheEntry.revokeTimer = null;
    }

    cacheEntry.refCount += 1;
    setObjectUrl(cacheEntry.url);

    return () => {
      const currentEntry = objectUrlCache.get(documentIdentity);

      if (!currentEntry) {
        return;
      }

      currentEntry.refCount = Math.max(0, currentEntry.refCount - 1);

      if (currentEntry.refCount > 0 || currentEntry.revokeTimer) {
        return;
      }

      currentEntry.revokeTimer = setTimeout(() => {
        const latestEntry = objectUrlCache.get(documentIdentity);

        if (!latestEntry || latestEntry.refCount > 0) {
          return;
        }

        URL.revokeObjectURL(latestEntry.url);
        objectUrlCache.delete(documentIdentity);
      }, 0);
    };
  }, [blob, documentIdentity]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return objectUrl;
}
