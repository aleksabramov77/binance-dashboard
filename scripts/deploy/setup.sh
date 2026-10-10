#!/usr/bin/env bash
# Первичная настройка VM (Oracle Cloud Always Free, Ubuntu 24.04, ARM или x86).
# Запуск на VM от пользователя с sudo (на Oracle — ubuntu). Репозиторий приватный, поэтому скрипт
# копируется с Mac: scp scripts/deploy/setup.sh ubuntu@<ip>:~ && ssh ubuntu@<ip> 'bash setup.sh'
# Повторный запуск безопасен: каждый шаг проверяет, сделан ли он уже.
#
# Переменные (необязательные):
#   DOMAIN    — домен для HTTPS; по умолчанию <публичный-ip>.sslip.io
#   APP_DIR   — каталог приложения; по умолчанию /opt/binance-dashboard
#   REPO      — git-адрес репозитория; по умолчанию git@github.com:aleksabramov77/binance-dashboard.git
#   PORT      — порт Next.js за Caddy; по умолчанию 5000
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/binance-dashboard}"
REPO="${REPO:-git@github.com:aleksabramov77/binance-dashboard.git}"
PORT="${PORT:-5000}"
NODE_MAJOR=22 # как в CI (.github/workflows/ci.yml)
APP_USER="$(id -un)"
SERVICE=binance-dashboard

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. Binance доступен с этого IP? ---------------------------------------
# Binance блокирует часть стран и дата-центров ответом 451 (или 403). Проверяем до всего остального,
# чтобы не настраивать сервер, с которого приложение всё равно не получит цены.
step "Проверка доступа к Binance с IP этой VM"
check_binance() {
  local url=$1 code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo 000)
  case "$code" in
    200) echo "  ✓ $url → 200" ;;
    451 | 403) fail "$url → $code: Binance блокирует IP этой VM (restricted location). Нужен другой регион." ;;
    *) fail "$url → $code: нет ответа от Binance. Проверьте сеть VM и повторите." ;;
  esac
}
check_binance https://api.binance.com/api/v3/ping
check_binance https://fapi.binance.com/fapi/v1/ping

# --- 2. Пакеты ---------------------------------------------------------------
step "Системные пакеты"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https \
  iptables-persistent netfilter-persistent >/dev/null

# --- 3. Swap: сборка Next.js на 1 ГБ (E2.1.Micro) без него падает по памяти ---
step "Swap"
if ! swapon --show | grep -q /swapfile; then
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  swap_gb=$((mem_mb < 4096 ? 4 : 2))
  sudo fallocate -l "${swap_gb}G" /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "  swap ${swap_gb} ГБ включён"
else
  echo "  swap уже есть"
fi

# --- 4. Node.js + pnpm -------------------------------------------------------
step "Node.js ${NODE_MAJOR} и pnpm"
if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
# Версия pnpm — из packageManager в package.json (corepack).
sudo corepack enable
echo "  node $(node --version)"

# --- 5. Caddy (HTTPS от Let's Encrypt) ---------------------------------------
step "Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' |
    sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy >/dev/null
fi

# --- 6. Файрвол --------------------------------------------------------------
# В образах Ubuntu от Oracle уже есть правила iptables (/etc/iptables/rules.v4) с REJECT всего,
# кроме SSH. ufw поверх них не помогает: их REJECT стоит раньше цепочек ufw, и порт остаётся
# закрытым. Поэтому открываем 80/443 в тех же iptables и сохраняем правила.
step "Файрвол: открыть 80 и 443"
for p in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null; then
    # Вставляем перед REJECT (если его нет — в начало).
    pos=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
    sudo iptables -I INPUT "${pos:-1}" -p tcp --dport "$p" -m state --state NEW -j ACCEPT
  fi
done
sudo netfilter-persistent save >/dev/null
echo "  80/443 открыты (не забудьте Ingress Rules в Security List VCN — docs/ai/deploy.md)"

# --- 7. Deploy key для приватного репозитория ---------------------------------
step "Ключ для чтения репозитория (Deploy key)"
KEY=~/.ssh/github_deploy
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N '' -C "binance-dashboard-vm" -f "$KEY" >/dev/null
fi
if ! grep -q 'Host github.com' ~/.ssh/config 2>/dev/null; then
  printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" >>~/.ssh/config
  chmod 600 ~/.ssh/config
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null >>~/.ssh/known_hosts
sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts

# --- 8. Код приложения -------------------------------------------------------
step "Код приложения в ${APP_DIR}"
sudo mkdir -p "$APP_DIR"
sudo chown "$APP_USER:$APP_USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  if ! git clone -q "$REPO" "$APP_DIR"; then
    echo
    echo "Добавьте этот публичный ключ в GitHub: репозиторий → Settings → Deploy keys → Add deploy key"
    echo "(Allow write access — НЕ отмечать), затем запустите setup.sh ещё раз:"
    echo
    cat "$KEY.pub"
    exit 2
  fi
fi

# --- 9. .env -----------------------------------------------------------------
step "Файл окружения ${APP_DIR}/.env.production.local"
ENV_FILE="$APP_DIR/.env.production.local"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/scripts/deploy/env.production.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  создан из шаблона — заполните секреты (nano $ENV_FILE)"
fi

# --- 10. systemd -------------------------------------------------------------
step "systemd-юнит ${SERVICE}"
sudo tee "/etc/systemd/system/${SERVICE}.service" >/dev/null <<UNIT
[Unit]
Description=Binance Dashboard (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
ExecStart=/usr/bin/node ${APP_DIR}/node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null

# --- 11. Caddyfile -----------------------------------------------------------
step "HTTPS-адрес"
if [ -z "${DOMAIN:-}" ]; then
  ip=$(curl -s --max-time 10 https://api.ipify.org || true)
  [ -n "$ip" ] || fail "не удалось узнать публичный IP; задайте DOMAIN=<ip>.sslip.io"
  DOMAIN="${ip}.sslip.io"
fi
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
${DOMAIN} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:${PORT}
}
CADDY
sudo systemctl reload caddy || sudo systemctl restart caddy

# --- 12. Первая сборка и запуск -----------------------------------------------
step "Сборка и запуск"
bash "$APP_DIR/scripts/deploy/deploy.sh"

echo
echo "Готово: https://${DOMAIN}"
echo "Журнал сервиса: journalctl -u ${SERVICE} -f"
