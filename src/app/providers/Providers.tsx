"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useEffect, useState } from "react";
import { reportClientError } from "@/shared/lib";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Любая ошибка запроса/действия в браузере попадает в серверный журнал.
        queryCache: new QueryCache({
          onError: (error, query) =>
            reportClientError("query", error, { queryKey: query.queryKey }),
        }),
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) =>
            reportClientError("mutation", error, {
              mutationKey: mutation.options.mutationKey ?? null,
            }),
        }),
        defaultOptions: {
          queries: { staleTime: 60_000, refetchOnWindowFocus: true },
        },
      }),
  );

  useEffect(() => {
    const onError = (e: ErrorEvent) =>
      reportClientError("window.error", e.error ?? e.message, {
        file: e.filename,
        line: e.lineno,
      });
    const onRejection = (e: PromiseRejectionEvent) =>
      reportClientError("unhandledrejection", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryClientProvider>
  );
}
