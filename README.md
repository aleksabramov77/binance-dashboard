# Binance Dashboard

> Концепция, требования и этапы — в [docs/PRD.md](docs/PRD.md).

Личный локальный дашборд по Binance.

- **Портфель** (`/portfolio`) — где лежат ваши деньги (Spot, Funding, Earn Flexible/Locked), сколько они
  приносят и оптимальный план «куда переложить» с учётом бонусных ступеней (+ Locked-альтернатива).
- **Earn** (`/earn`): свежие предложения Simple Earn
(Flexible + Locked), реальная ставка для вашей суммы с учётом бонусных ступеней
(«+2% до 10 000 USDC, дальше базовая») и лента изменений между снимками.

## Запуск

```bash
pnpm install
pnpm snapshot   # скачать свежие предложения с Binance (без API-ключа)
pnpm dev        # http://localhost:5000/earn (если занят — 5001, 5002…; точный адрес в консоли)
```

## Подключение аккаунта (только чтение)

1. binance.com → API Management → Create API → System generated.
2. Включить только **Enable Reading** (без торговли и вывода).
3. Скопировать `.env.example` в `.env.local` и вписать `BINANCE_API_KEY` / `BINANCE_API_SECRET`.
4. Перезапустить `pnpm dev`.

Ключ используется только сервером дашборда и в git не попадает (`.env*` в `.gitignore`).

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
