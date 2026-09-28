"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { RouteGuard } from "@/components/providers/route-guard";
import { SessionProvider } from "@/components/providers/session-provider";
import { Toaster } from "@/components/ui/sonner";
import { createAppQueryClient } from "@/lib/query";

export function AppProviders({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [queryClient] = useState(createAppQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouteGuard>{children}</RouteGuard>
        <Toaster closeButton richColors position="top-right" />
      </SessionProvider>
    </QueryClientProvider>
  );
}
