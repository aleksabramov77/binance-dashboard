#!/usr/bin/env bash
# Проект на VM apps-tokyo (spec 0017): Linux-пользователь, каталоги, секреты, systemd-сервис с лимитами, сайт в Caddy.
# Запуск — от root после bootstrap.sh; повторный запуск обновляет unit и сайт, секреты и данные не трогает.
#   sudo bash add-project.sh binance --port 5000                    сайт: https://binance.<ip>.sslip.io
#   sudo bash add-project.sh binance-live --no-web --exec live-worker.mjs --memory 128M --heap 96
# Параметры:
#   --port N        порт приложения на 127.0.0.1 (сайт); обязателен без --no-web
#   --no-web        фоновый сервис: без порта и без Caddy
#   --exec FILE     файл в /srv/<имя>/app, который запускает node (по умолчанию server.js — Next.js standalone)
#   --memory SIZE   MemoryMax сервиса (по умолчанию 300M)
#   --heap MB       --max-old-space-size для node (по умолчанию не задаётся)
#   --domain HOST   адрес сайта (по умолчанию <имя>.<публичный-ip>.sslip.io)
set -euo pipefail

fail() { printf '\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "запускать от root: sudo bash $0 …"
NAME=${1:-}
[[ "$NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || fail "имя проекта: строчные латинские буквы, цифры и дефис"
shift

PORT="" WEB=1 EXEC=server.js MEMORY=300M HEAP="" DOMAIN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT=$2; shift 2 ;;
    --no-web) WEB=0; shift ;;
    --exec) EXEC=$2; shift 2 ;;
    --memory) MEMORY=$2; shift 2 ;;
    --heap) HEAP=$2; shift 2 ;;
    --domain) DOMAIN=$2; shift 2 ;;
    *) fail "неизвестный параметр $1" ;;
  esac
done
[ "$WEB" = 0 ] || [[ "$PORT" =~ ^[0-9]{4,5}$ ]] || fail "для сайта нужен --port"
id deploy >/dev/null 2>&1 || fail "нет пользователя deploy — сначала bootstrap.sh"

APP=/srv/$NAME/app
DATA=/var/lib/$NAME
ETC=/etc/$NAME

# Пользователь сервиса: без входа и без sudo.
id "$NAME" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$NAME"

# Код кладёт deploy (выкатка из CI), сервис только читает; данные — только у сервиса.
install -d -m 755 "/srv/$NAME"
# setgid: файлы выкатки наследуют группу сервиса (rsync --chmod=D2750,F640 в deploy.yml).
install -d -m 2750 -o deploy -g "$NAME" "$APP"
install -d -m 700 -o "$NAME" -g "$NAME" "$DATA"
install -d -m 750 -o root -g "$NAME" "$ETC"
[ -f "$ETC/app.env" ] || install -m 640 -o root -g "$NAME" /dev/null "$ETC/app.env"
# Сайт на Next.js пишет кэш в .next/cache: выкатка делает его ссылкой сюда (код только для чтения).
[ "$WEB" = 1 ] && install -d -m 700 -o "$NAME" -g "$NAME" "$DATA/cache"

NODE_OPTS=""
[ -n "$HEAP" ] && NODE_OPTS="Environment=NODE_OPTIONS=--max-old-space-size=$HEAP"
WEB_ENV=""
[ "$WEB" = 1 ] && WEB_ENV="Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1"

cat >"/etc/systemd/system/$NAME.service" <<UNIT
[Unit]
Description=$NAME (apps-tokyo)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$NAME
Group=$NAME
WorkingDirectory=$APP
EnvironmentFile=$ETC/app.env
Environment=NODE_ENV=production
$WEB_ENV
$NODE_OPTS
ExecStart=/usr/bin/node $APP/$EXEC
Restart=always
RestartSec=10
MemoryMax=$MEMORY
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$DATA
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
# Пока кода нет, сервис выключен и при загрузке не стартует (иначе перезапуск каждые 10 с); включает первая выкатка.
if [ -f "$APP/$EXEC" ]; then
  systemctl enable "$NAME" >/dev/null 2>&1
  systemctl restart "$NAME"
else
  systemctl disable "$NAME" >/dev/null 2>&1 || true
fi

# deploy может только включить и перезапустить сервис и посмотреть его состояние и последние 80 строк журнала.
cat >"/etc/sudoers.d/50-deploy-$NAME" <<SUDO
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable $NAME, /usr/bin/systemctl restart $NAME, /usr/bin/systemctl status $NAME --no-pager, /usr/bin/journalctl -u $NAME -n 80 --no-pager
SUDO
chmod 440 "/etc/sudoers.d/50-deploy-$NAME"
visudo -cq || fail "sudoers не прошёл проверку visudo"

if [ "$WEB" = 1 ]; then
  if [ -z "$DOMAIN" ]; then
    ip=$(curl -s --max-time 10 https://api.ipify.org || true)
    [ -n "$ip" ] || fail "не удалось узнать публичный IP; задайте --domain"
    DOMAIN="$NAME.$ip.sslip.io"
  fi
  cat >"/etc/caddy/sites/$NAME.caddy" <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || fail "Caddyfile не прошёл проверку"
  systemctl reload caddy
  echo "Сайт: https://$DOMAIN → 127.0.0.1:$PORT"
fi

echo "Проект $NAME: код $APP (выкатка deploy), данные $DATA, секреты $ETC/app.env, сервис $NAME.service ($MEMORY)"
