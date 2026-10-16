import { definePreview } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import addonMsw from "msw-storybook-addon";
import { type ReactNode, useState } from "react";
import "../src/app/styles/globals.css";

// Как в app/layout.tsx: приложение только в тёмной теме, язык — русский (формат чисел и дат).
document.documentElement.classList.add("dark");
document.documentElement.lang = "ru";

/** Свой кэш на каждую историю: данные одной истории не перетекают в другую. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export default definePreview({
  addons: [addonMsw()],
  decorators: [
    (Story, { id }) => (
      <QueryProvider key={id}>
        <Story />
      </QueryProvider>
    ),
  ],
  parameters: {
    // usePathname и прочее из next/navigation (App Router).
    nextjs: { appDirectory: true },
    layout: "fullscreen",
    viewport: {
      options: {
        phone: {
          name: "Телефон 375",
          styles: { width: "375px", height: "812px" },
          type: "mobile",
        },
        tablet: {
          name: "Планшет 768",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        laptop: {
          name: "Ноутбук 1280",
          styles: { width: "1280px", height: "800px" },
          type: "desktop",
        },
      },
    },
  },
});
