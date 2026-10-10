# Хостинг на Supabase (spec 007b)

Supabase-проект `binance-lab`, регион Northeast Asia (Tokyo), `ap-northeast-1`. Код Edge Functions —
в `supabase/functions/*` (Deno), конфигурация CLI — `supabase/config.toml`. Эти файлы не входят в
Next-приложение: `tsconfig.json` их исключает (у них свой рантайм с глобальным `Deno`), Biome их проверяет.

Пошаговая инструкция для пользователя (Vercel, GitHub OAuth, переключение раннера) появится в задачах
AC4–AC6 spec 007b.

## Деплой функции
Нужны `SUPABASE_PROJECT_REF` и `SUPABASE_ACCESS_TOKEN` в `.env.local` (как получить — `.env.example`).
Docker не нужен: флаг `--use-api` собирает функцию на стороне Supabase.

```bash
set -a; source .env.local; set +a
pnpm dlx supabase@2.120.0 functions deploy binance-ping --project-ref "$SUPABASE_PROJECT_REF" --use-api
```

CLI кладёт локальное состояние в `supabase/.temp/` — папка в `.gitignore`.

## Проверка доступа к Binance
Функция `binance-ping` параллельно вызывает публичные `GET https://api.binance.com/api/v3/ping` (Spot)
и `GET https://fapi.binance.com/fapi/v1/ping` (USDⓈ-M Futures) с таймаутом 8 с. Ключей Binance нет.

Проверка JWT включена (`verify_jwt = true`), поэтому вызов — с publishable/anon ключом проекта
(Project Settings → API Keys). Ключ в git не коммитим.

```bash
curl -i "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/binance-ping?forceFunctionRegion=ap-northeast-1" \
  -H "Authorization: Bearer <publishable или anon key>"
```

Вместо `?forceFunctionRegion=` можно передать заголовок `x-region: ap-northeast-1`. Без них Supabase
запускает функцию в регионе, ближайшем к вызывающему, — для проверки Binance это бессмысленно.

Ответ:
```json
{
  "spot": { "status": 200, "ms": 45 },
  "futures": { "status": 200, "ms": 52 },
  "region": "ap-northeast-1",
  "at": "2026-10-10T07:45:00.000Z"
}
```

Что смотреть:
- **Заголовок `x-sb-edge-region`** — где реально выполнилась функция. Должен совпадать с запрошенным
  регионом; `region` в теле — то же самое из переменной `SB_REGION` рантайма.
- **`status: 200`** — Binance пускает запросы из этого региона, движок может работать здесь.
- **`451`** — Binance блокирует регион (ограниченная юрисдикция). **`403`** — блокировка CloudFront/WAF.
  В обоих случаях регион не годится: проверить запасные (`ap-south-1` Mumbai, `ap-southeast-1`
  Singapore, `ap-northeast-2` Seoul) и сообщить пользователю — смена региона движка — его решение.
- **`status: null` + `error`** — сетевая ошибка или таймаут 8 с; повторить вызов.
- **HTTP 401 от самой функции** (`sb-error-code: UNAUTHORIZED_*`) — не передан или неверен ключ.

Результаты проверок — в spec 007b, критерий AC1.
