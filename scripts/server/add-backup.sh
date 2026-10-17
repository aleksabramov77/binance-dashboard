#!/usr/bin/env bash
# Ночные копии базы проекта на VM apps-tokyo (spec 0062): скрипт /usr/local/bin/<проект>-db-backup, сервис
# <проект>-backup.service (oneshot, от пользователя проекта) и таймер <проект>-backup.timer (23:30 UTC — до снимка
# Lightsail в 00:00, свежая копия попадает и в снимок). Каталог копий /var/lib/<проект>/backups (700).
# Запуск — от root после add-project.sh; повторный запуск безопасен (перезаписывает скрипт и unit'ы).
#   sudo bash add-backup.sh binance
set -euo pipefail

fail() { printf '\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "запускать от root: sudo bash $0 <проект>"
NAME=${1:-}
[[ "$NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || fail "имя проекта: строчные латинские буквы, цифры и дефис"
id "$NAME" >/dev/null 2>&1 || fail "нет пользователя $NAME — сначала add-project.sh $NAME"
DATA=/var/lib/$NAME
[ -d "$DATA" ] || fail "нет каталога $DATA"
command -v sqlite3 >/dev/null || fail "нет sqlite3 (ставит bootstrap.sh)"

HERE=$(cd "$(dirname "$0")" && pwd)
BIN=/usr/local/bin/$NAME-db-backup
install -m 755 -o root -g root "$HERE/db-backup.sh" "$BIN"
install -d -m 700 -o "$NAME" -g "$NAME" "$DATA/backups"

cat >"/etc/systemd/system/$NAME-backup.service" <<UNIT
[Unit]
Description=$NAME: ночная копия базы (spec 0062)

[Service]
Type=oneshot
User=$NAME
Group=$NAME
Nice=10
IOSchedulingClass=idle
ExecStart=$BIN --db $DATA/app.db --dir $DATA/backups --logs $DATA/logs
UNIT

cat >"/etc/systemd/system/$NAME-backup.timer" <<UNIT
[Unit]
Description=$NAME: ночная копия базы в 23:30 UTC (spec 0062)

[Timer]
OnCalendar=*-*-* 23:30:00 UTC
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now "$NAME-backup.timer" >/dev/null 2>&1
echo "Копии базы $NAME: $BIN, каталог $DATA/backups, таймер $NAME-backup.timer ($(systemctl show -p NextElapseUSecRealtime --value "$NAME-backup.timer"))"
