# Binance Dashboard

Личный локальный дашборд по Binance. Первый раздел — **Earn**: свежие предложения Simple Earn
(Flexible + Locked), реальная ставка для вашей суммы с учётом бонусных ступеней
(«+2% до 10 000 USDC, дальше базовая») и лента изменений между снимками.

## Запуск

```bash
pnpm install
pnpm snapshot   # скачать свежие предложения с Binance (без API-ключа)
pnpm dev        # http://localhost:3000/earn
```

## Обновление 2 раза в день

```bash
pnpm schedule:install   # launchd: снимки в 09:00 и 21:00, лог в data/snapshot.log
```

Снимки лежат в `data/snapshots/*.json` (не в git). Кнопка «Обновить сейчас» на странице делает то же самое.

## Стек и структура

Next.js (App Router) · TypeScript strict · TanStack Query · nuqs · Zod · Tailwind + shadcn/ui · Biome · Vitest.
Архитектура — Feature-Sliced Design: роутинг в корневой `app/`, слои в `src/`
(`app` → `pages` → `widgets` → `features` → `entities` → `shared`). Новый раздел = страница в `src/pages`,
роут в `app/<раздел>/page.tsx` и пункт в `src/shared/config/navigation.ts`.

## Проверки

```bash
pnpm lint && pnpm typecheck && pnpm test
```
