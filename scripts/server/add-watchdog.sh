#!/usr/bin/env bash
# Сторож проекта на VM apps-tokyo (spec 0064): скрипт /usr/local/bin/<проект>-watchdog (= watchdog.sh), сервис
# <проект>-watchdog.service (oneshot, от root: читает /etc/<проект>/app.env для Telegram и делает systemctl restart
# <проект>) и таймер <проект>-watchdog.timer — каждые 2 мин на 40-й секунде (мимо тика +5 с и демо-зеркала +20 с).
# Состояние эпизодов — /var/lib/<проект>-watchdog (700). Запуск — от root после add-project.sh; повтор безопасен.
#   sudo bash add-watchdog.sh binance
set -euo pipefail

fail() { printf '\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "запускать от root: sudo bash $0 <проект>"
NAME=${1:-}
[[ "$NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || fail "имя проекта: строчные латинские буквы, цифры и дефис"
[ -d "/var/lib/$NAME" ] || fail "нет каталога /var/lib/$NAME — сначала add-project.sh $NAME"
[ -f "/etc/$NAME/app.env" ] || fail "нет /etc/$NAME/app.env"
command -v sqlite3 >/dev/null || fail "нет sqlite3 (ставит bootstrap.sh)"
command -v curl >/dev/null || fail "нет curl"

HERE=$(cd "$(dirname "$0")" && pwd)
BIN=/usr/local/bin/$NAME-watchdog
STATE=/var/lib/$NAME-watchdog
install -m 755 -o root -g root "$HERE/watchdog.sh" "$BIN"
install -d -m 700 -o root -g root "$STATE"

# /var/lib/<проект> — на запись: sqlite3 -readonly у базы в режиме WAL работает с её -shm.
cat >"/etc/systemd/system/$NAME-watchdog.service" <<UNIT
[Unit]
Description=$NAME: сторож тика и сайта (spec 0064)

[Service]
Type=oneshot
ExecStart=$BIN --db /var/lib/$NAME/app.db --env-file /etc/$NAME/app.env --state-dir $STATE --service $NAME
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$STATE /var/lib/$NAME
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UNIT

cat >"/etc/systemd/system/$NAME-watchdog.timer" <<UNIT
[Unit]
Description=$NAME: сторож каждые 2 мин (spec 0064)

[Timer]
OnCalendar=*-*-* *:0/2:40
AccuracySec=5s
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now "$NAME-watchdog.timer"
echo "Сторож $NAME: $BIN, состояние $STATE, таймер $NAME-watchdog.timer ($(systemctl show -p NextElapseUSecRealtime --value "$NAME-watchdog.timer"))"
