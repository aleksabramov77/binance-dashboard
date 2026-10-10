#!/usr/bin/env bash
# Обновление приложения на VM: git pull → pnpm i → build → migrate (если есть) → restart.
# Запускается на VM: из GitHub Actions (deploy.yml) по ssh или вручную.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/binance-dashboard}"
SERVICE=binance-dashboard
PORT="${PORT:-5000}"
ENV_FILE="$APP_DIR/.env.production.local"

fail() { printf '\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
# Значение переменной из env-файла (пусто — не задана).
env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' '; }

cd "$APP_DIR"

# Сначала код: git reset перезаписывает и этот файл, а bash читает скрипт по ходу выполнения.
# Поэтому обновление и exec новой версии — в одной строке, дальше работает уже свежий deploy.sh.
if [ -z "${DEPLOY_UPDATED:-}" ]; then
  echo "==> git: $(git rev-parse --short HEAD) → origin/main"
  git fetch -q origin main
  # Сервер — только копия main: локальные правки (их быть не должно) отбрасываются.
  git reset -q --hard origin/main && DEPLOY_UPDATED=1 exec bash "$APP_DIR/scripts/deploy/deploy.sh" "$@"
fi
echo "    $(git rev-parse --short HEAD) $(git log -1 --format=%s)"

# Ключи Binance на сервер не кладём (решение владельца 2026-10-10, docs/ai/deploy.md):
# ключ реального аккаунта — никогда, demo-ключи — только по отдельному решению (ALLOW_DEMO_KEYS=yes).
[ -z "$(env_value BINANCE_API_KEY)$(env_value BINANCE_API_SECRET)" ] ||
  fail "в $ENV_FILE задан ключ реального аккаунта Binance (BINANCE_API_KEY/SECRET). На сервере он запрещён — удалите строки."
if [ -n "$(env_value BINANCE_DEMO_API_KEY)$(env_value BINANCE_DEMO_API_SECRET)" ] &&
  [ "$(env_value ALLOW_DEMO_KEYS)" != "yes" ]; then
  fail "в $ENV_FILE заданы demo-ключи Binance без ALLOW_DEMO_KEYS=yes. Их добавляют только по решению владельца."
fi

echo "==> pnpm install"
corepack pnpm install --frozen-lockfile --prefer-offline

echo "==> build"
corepack pnpm build

if node -e 'process.exit(require("./package.json").scripts?.["db:migrate"] ? 0 : 1)'; then
  echo "==> db:migrate"
  corepack pnpm db:migrate
fi

echo "==> restart"
sudo systemctl restart "$SERVICE"

# Ждём, пока сервер ответит. Любой HTTP-ответ < 500 (в т.ч. редирект на вход) — значит, поднялся.
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/" || echo 000)
  if [ "$code" != 000 ] && [ "$code" -lt 500 ]; then
    echo "==> OK: http://127.0.0.1:${PORT}/ → $code"
    exit 0
  fi
  sleep 2
done
journalctl -u "$SERVICE" -n 50 --no-pager || true
fail "сервер не ответил за 60 с (последний код: $code)"
