#!/usr/bin/env bash
# Общая настройка VM apps-tokyo (AWS Lightsail, Ubuntu 24.04) под несколько личных проектов (spec 0017).
# Запуск — от root (sudo), повторный запуск безопасен: каждый шаг проверяет, сделан ли он уже.
#   sudo CLAUDE_KEY="ssh-ed25519 …" DEPLOY_KEY="ssh-ed25519 …" [OWNER_KEY="ssh-ed25519 …"] bash bootstrap.sh
#   Повторный запуск (claude уже настроен) закрывает встроенного ubuntu сам; LOCK_UBUNTU=1 — закрыть сразу.
# Проекты добавляет add-project.sh. Адреса и ключи в git не пишем: репозиторий публичный.
set -euo pipefail

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "запускать от root: sudo bash $0"

NODE_MAJOR=22 # как в CI (.github/workflows/ci.yml)
SWAP_GB=2

# --- 1. Binance доступен с этого IP? ---------------------------------------
# Binance блокирует часть стран и дата-центров ответом 451/403 — проверяем до всего остального.
step "Доступ к Binance с IP этой VM"
for url in https://api.binance.com/api/v3/ping https://fapi.binance.com/fapi/v1/ping; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo 000)
  case "$code" in
    200) echo "  ✓ $url → 200" ;;
    451 | 403) fail "$url → $code: Binance блокирует IP этой VM (restricted location)" ;;
    *) fail "$url → $code: нет ответа от Binance" ;;
  esac
done

# --- 2. Пакеты ---------------------------------------------------------------
step "Системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg rsync sqlite3 fail2ban unattended-upgrades \
  debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# Обновления безопасности ставятся сами; перезагрузку не делаем — решает владелец.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now fail2ban >/dev/null 2>&1
echo "  unattended-upgrades и fail2ban (jail sshd) включены"

# --- 3. Swap: на 512 МБ без него процессы упираются в память ------------------
step "Swap ${SWAP_GB} ГБ"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  # Swap — запас на пики, а не рабочая память.
  echo 'vm.swappiness=10' >/etc/sysctl.d/90-swap.conf
  sysctl -q -p /etc/sysctl.d/90-swap.conf
  echo "  включён"
else
  echo "  уже есть"
fi

# --- 3a. TCP BBR: быстрее на длинном маршруте с потерями (сайт из сети владельца, решение 2026-10-17) ------
step "TCP BBR"
echo tcp_bbr >/etc/modules-load.d/bbr.conf
modprobe tcp_bbr
printf 'net.core.default_qdisc=fq\nnet.ipv4.tcp_congestion_control=bbr\n' >/etc/sysctl.d/90-bbr.conf
sysctl -q -p /etc/sysctl.d/90-bbr.conf
echo "  $(sysctl -n net.ipv4.tcp_congestion_control), qdisc $(sysctl -n net.core.default_qdisc)"

# --- 4. Node.js -----------------------------------------------------------------
step "Node.js ${NODE_MAJOR}"
if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "  node $(node --version)"

# --- 5. Caddy: HTTPS (Let's Encrypt) для всех проектов -------------------------
step "Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
# Общий Caddyfile только подключает сайты проектов: /etc/caddy/sites/<проект>.caddy (add-project.sh).
mkdir -p /etc/caddy/sites
cat >/etc/caddy/Caddyfile <<'CADDY'
import /etc/caddy/sites/*.caddy
CADDY
systemctl reload caddy 2>/dev/null || systemctl restart caddy
echo "  $(caddy version | cut -d' ' -f1)"

# --- 6. Пользователи -------------------------------------------------------------
# claude — администратор для AI, aleksandr — администратор для владельца: sudo без пароля (паролей нет,
# вход только по ключу). deploy — вход для GitHub Actions, права — только sudoers проектов (add-project.sh).
step "Пользователи"
# Вход claude уже был настроен до этого запуска — значит, его проверили, и встроенный ubuntu закрываем всегда.
CLAUDE_READY=0
[ -s /home/claude/.ssh/authorized_keys ] && CLAUDE_READY=1
add_login_user() { # <имя> <ключ> <sudo:yes|no>
  local name=$1 key=$2 admin=$3
  id "$name" >/dev/null 2>&1 || useradd -m -s /bin/bash "$name"
  install -d -m 700 -o "$name" -g "$name" "/home/$name/.ssh"
  local auth="/home/$name/.ssh/authorized_keys"
  touch "$auth"
  grep -qxF "$key" "$auth" || echo "$key" >>"$auth"
  chown "$name:$name" "$auth"
  chmod 600 "$auth"
  if [ "$admin" = yes ]; then
    echo "$name ALL=(ALL) NOPASSWD:ALL" >"/etc/sudoers.d/90-$name"
    chmod 440 "/etc/sudoers.d/90-$name"
  fi
  echo "  ✓ $name"
}
[ -n "${CLAUDE_KEY:-}" ] && add_login_user claude "$CLAUDE_KEY" yes
[ -n "${OWNER_KEY:-}" ] && add_login_user aleksandr "$OWNER_KEY" yes
[ -n "${DEPLOY_KEY:-}" ] && add_login_user deploy "$DEPLOY_KEY" no
visudo -cq || fail "sudoers не прошёл проверку visudo"

# --- 7. SSH: только ключи, без root ----------------------------------------------
step "SSH"
allow="claude aleksandr deploy"
# Встроенный ubuntu остаётся только на первом запуске, пока вход под claude не проверен. Со второго запуска (или
# LOCK_UBUNTU=1) он закрыт: нет в AllowUsers, нет ключа и sudo от cloud-init.
if [ "$CLAUDE_READY" = 1 ] || [ "${LOCK_UBUNTU:-0}" = 1 ]; then
  rm -f /home/ubuntu/.ssh/authorized_keys /etc/sudoers.d/90-cloud-init-users
else
  allow="$allow ubuntu"
fi
cat >/etc/ssh/sshd_config.d/10-apps-tokyo.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers ${allow}
CONF
sshd -t || fail "конфиг sshd с ошибкой — не перезапускаю"
systemctl reload ssh
echo "  вход разрешён: ${allow}"

echo
echo "Готово. Проекты: sudo bash add-project.sh <имя> --port N | <имя> --no-web --exec <файл>"
