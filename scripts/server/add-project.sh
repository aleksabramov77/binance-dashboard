#!/usr/bin/env bash
# Проект на VM apps-tokyo (spec 0017): Linux-пользователь, каталоги, секреты, systemd-сервис с лимитами, сайт в Caddy.
# Запуск — от root после bootstrap.sh; повторный запуск обновляет unit и сайт, секреты, мастер-ключ и данные не трогает.
#   sudo bash add-project.sh binance --port 5000 --stop-timeout 30  сайт: https://binance.<ip>.sslip.io
#   sudo bash add-project.sh binance-live --no-web --exec live-worker.mjs --memory 128M --heap 96 --stop-timeout 120
# Параметры:
#   --port N        порт приложения на 127.0.0.1 (сайт); обязателен без --no-web
#   --no-web        фоновый сервис: без порта и без Caddy
#   --exec FILE     файл в /srv/<имя>/app, который запускает node (по умолчанию server.js — Next.js standalone)
#   --memory SIZE   MemoryMax сервиса (по умолчанию 300M)
#   --heap MB       --max-old-space-size для node (по умолчанию не задаётся)
#   --domain HOST   адрес сайта (по умолчанию <имя>.<публичный-ip>.sslip.io)
#   --stop-timeout SEC  сколько секунд ждать остановки после SIGTERM до SIGKILL (TimeoutStopSec, KillSignal=SIGTERM);
#                   по умолчанию не задаётся — systemd ждёт 90 с
set -euo pipefail

fail() { printf '\033[1;31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "запускать от root: sudo bash $0 …"
NAME=${1:-}
[[ "$NAME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || fail "имя проекта: строчные латинские буквы, цифры и дефис"
shift

PORT="" WEB=1 EXEC=server.js MEMORY=300M HEAP="" DOMAIN="" STOP_TIMEOUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT=$2; shift 2 ;;
    --no-web) WEB=0; shift ;;
    --exec) EXEC=$2; shift 2 ;;
    --memory) MEMORY=$2; shift 2 ;;
    --heap) HEAP=$2; shift 2 ;;
    --domain) DOMAIN=$2; shift 2 ;;
    --stop-timeout) STOP_TIMEOUT=${2:-}; shift 2 ;;
    *) fail "неизвестный параметр $1" ;;
  esac
done
[ "$WEB" = 0 ] || [[ "$PORT" =~ ^[0-9]{4,5}$ ]] || fail "для сайта нужен --port"
case "$NAME" in root | ubuntu | claude | aleksandr | deploy | caddy | www-data | nobody) fail "имя $NAME занято служебным пользователем" ;; esac
[[ "$MEMORY" =~ ^[0-9]+[KMG]$ ]] || fail "--memory: число с K/M/G, например 300M"
[ -z "$HEAP" ] || [[ "$HEAP" =~ ^[0-9]+$ ]] || fail "--heap: число мегабайт"
[[ "$EXEC" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$EXEC" != *..* ]] || fail "--exec: путь внутри каталога кода"
[ -z "$DOMAIN" ] || [[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || fail "--domain: только имя хоста"
[ -z "$STOP_TIMEOUT" ] || [[ "$STOP_TIMEOUT" =~ ^[1-9][0-9]{0,3}$ ]] || fail "--stop-timeout: целое число секунд от 1 до 9999"
id deploy >/dev/null 2>&1 || fail "нет пользователя deploy — сначала bootstrap.sh"

APP=/srv/$NAME/app
DATA=/var/lib/$NAME
ETC=/etc/$NAME

# Пользователь сервиса: без входа и без sudo.
id "$NAME" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$NAME"

# Код кладёт deploy (выкатка из CI), сервис только читает; данные — только у сервиса.
install -d -m 755 "/srv/$NAME"
# Код открытый и читается всеми (секретов в нём нет, они в $ETC): deploy не в группе проекта, иначе он прочитал бы app.env.
install -d -m 755 -o deploy -g "$NAME" "$APP"
install -d -m 700 -o "$NAME" -g "$NAME" "$DATA"
install -d -m 750 -o root -g "$NAME" "$ETC"
[ -f "$ETC/app.env" ] || install -m 640 -o root -g "$NAME" /dev/null "$ETC/app.env"
# Мастер-ключ секретов в базе (spec 0065): 32 случайных байта в base64, читает только сервис. Есть непустой — не
# трогаем никогда: новый ключ сделал бы сохранённые в базе секреты нерасшифровываемыми. Не входит в бэкапы базы.
# Сайту нужен путь в app.env: SECRETS_KEY_FILE=$ETC/master.key. Фоновым сервисам (--no-web) не создаётся.
if [ "$WEB" = 1 ] && [ ! -s "$ETC/master.key" ]; then
  install -m 640 -o root -g "$NAME" /dev/null "$ETC/master.key"
  head -c 32 /dev/urandom | base64 >"$ETC/master.key"
  echo "Мастер-ключ: создан $ETC/master.key (root:$NAME 640)"
elif [ "$WEB" = 1 ]; then
  # Уже есть: содержимое не трогаем, только выравниваем владельца и права (сервис должен читать, другие — нет).
  chown root:"$NAME" "$ETC/master.key"
  chmod 640 "$ETC/master.key"
fi
# Сайт на Next.js пишет кэш в .next/cache: выкатка делает его ссылкой сюда (код только для чтения).
[ "$WEB" = 1 ] && install -d -m 700 -o "$NAME" -g "$NAME" "$DATA/cache"

NODE_OPTS=""
[ -n "$HEAP" ] && NODE_OPTS="Environment=NODE_OPTIONS=--max-old-space-size=$HEAP"
STOP_OPTS=""
[ -n "$STOP_TIMEOUT" ] && STOP_OPTS="KillSignal=SIGTERM
TimeoutStopSec=$STOP_TIMEOUT"
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
# Node на SIGTERM выходит с кодом 143 — это штатная остановка, а не сбой.
SuccessExitStatus=143
RestartSec=10
$STOP_OPTS
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
if [ "$WEB" = 1 ] && ! grep -q "^SECRETS_KEY_FILE=" "$ETC/app.env"; then
  echo "Добавьте в $ETC/app.env строку SECRETS_KEY_FILE=$ETC/master.key и перезапустите $NAME"
fi
