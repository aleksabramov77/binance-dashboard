import { defineMain } from "@storybook/nextjs-vite/node";
import tailwindcss from "@tailwindcss/vite";

// Storybook — витрина состояний компонентов (задача 0051): Next.js-компоненты через Vite, данные — моки MSW,
// без сервера и базы. Запуск — `pnpm storybook`, сборка статикой — `pnpm build-storybook`.
export default defineMain({
  framework: "@storybook/nextjs-vite",
  core: { disableTelemetry: true },
  stories: ["../src/**/*.stories.tsx"],
  // ./public — воркер MSW (mockServiceWorker.js): нужен только Storybook, в public приложения не кладём.
  staticDirs: ["../public", "./public"],
  // Приложение собирает Tailwind плагином Turbopack (next.config.ts), Storybook — плагином Vite.
  viteFinal: (config) => ({
    ...config,
    plugins: [...(config.plugins ?? []), tailwindcss()],
  }),
});
