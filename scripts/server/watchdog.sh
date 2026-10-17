#!/usr/bin/env bash
# Сторож прода на VM apps-tokyo (spec 0064): отдельный от приложения процесс (bash + sqlite3 + curl), его запускает
# binance-watchdog.timer каждые 2 мин (ставит add-watchdog.sh). Код приложения не используется — зависание приложения
# (2026-10-16: тик, демо-зеркало и монитор висели ~5 ч) сторожа не задевает.
#   - тик: автоторговля включена (engine_state.enabled), а last_tick старше TICK_ALERT_S → тревога в Telegram;
#     старше TICK_RESTART_S → systemctl restart сервиса, не чаще RESTART_EVERY_S;
#   - сайт: сервис активен и 127.0.0.1:5000 отвечает (< 500) за 10 с; SITE_FAILS неудач подряд → тревога;
#   - на эпизод одно сообщение; восстановление — сообщение с длительностью простоя. Состояние — STATE_DIR/state.
#   watchdog.sh [--test] [--db FILE] [--env-file FILE] [--state-dir DIR] [--url URL] [--service NAME]
# --test — пробное сообщение в Telegram, без проверок и перезапуска.
# Для проверки без прода: WATCHDOG_SYSTEMCTL / WATCHDOG_CURL — заглушки вместо systemctl / curl,
# WATCHDOG_TG_LOG=<файл> — сообщения пишутся в файл, а не в Telegram, WATCHDOG_NOW=<unix-время> — «сейчас».
set -uo pipefail

TICK_ALERT_S=300
TICK_RESTART_S=900
RESTART_EVERY_S=3600
SITE_FAILS=2

DB=/var/lib/binance/app.db
ENV_FILE=/etc/binance/app.env
STATE_DIR=/var/lib/binance-watchdog
URL=http://127.0.0.1:5000/
SERVICE=binance
TEST=0
while [ $# -gt 0 ]; do
  case "$1" in --db | --env-file | --state-dir | --url | --service)
    [ $# -ge 2 ] || { echo "ОШИБКА: $1 — нужно значение" >&2; exit 1; } ;;
  esac
  case "$1" in
    --test) TEST=1; shift ;;
    --db) DB=$2; shift 2 ;;
    --env-file) ENV_FILE=$2; shift 2 ;;
    --state-dir) STATE_DIR=$2; shift 2 ;;
    --url) URL=$2; shift 2 ;;
    --service) SERVICE=$2; shift 2 ;;
    *) echo "ОШИБКА: неизвестный параметр $1" >&2; exit 1 ;;
  esac
done

SYSTEMCTL=${WATCHDOG_SYSTEMCTL:-systemctl}
CURL=${WATCHDOG_CURL:-curl}
NOW=${WATCHDOG_NOW:-$(date +%s)}
STATE="$STATE_DIR/state"

# Значение переменной из env-файла без `source` (значения могут содержать что угодно); кавычки по краям снимаются.
env_value() {
  local v
  v=$(grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-) || true
  v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
  printf '%s' "$v"
}

# Сообщение в Telegram. Токен — через stdin (`--config -`): аргументы процесса видны в списке процессов.
tg() {
  local text="🛡 $SERVICE: $1"
  if [ -n "${WATCHDOG_TG_LOG:-}" ]; then printf '%s\n' "$text" >>"$WATCHDOG_TG_LOG"; return 0; fi
  local token chat
  token=$(env_value TELEGRAM_BOT_TOKEN)
  chat=$(env_value TELEGRAM_CHAT_ID)
  if [ -z "$token" ] || [ -z "$chat" ]; then echo "Telegram не настроен ($ENV_FILE): $text"; return 1; fi
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
    "$CURL" -s -o /dev/null -w '%{http_code}' --max-time 15 --config - \
      --data-urlencode "chat_id=$chat" --data-urlencode "text=$text" | grep -q '^200$' ||
    { echo "Telegram не принял сообщение: $text"; return 1; }
}

mins() { echo $((($1 + 59) / 60)); }
hhmm() { date -u -d "@$1" +%H:%M; }

# Тик: «enabled|ref_unix», где ref — последний тик или включение автоторговли, что позже (пока автоторговля выключена,
# тик last_tick не пишет: после включения его возраст — от момента включения). ref пустой — ни тика, ни отметки.
read_tick() {
  local row enabled at on ref=""
  row=$(sqlite3 -readonly "$DB" "select coalesce((select value from engine_state where key = 'enabled'), '') || '|' ||
    coalesce((select json_extract(value, '\$.at') from engine_state where key = 'last_tick'), '') || '|' ||
    coalesce((select updated_at / 1000 from engine_state where key = 'enabled'), '')" 2>&1) || return 1
  IFS='|' read -r enabled at on <<<"$row"
  if [ -n "$at" ]; then ref=$(date -d "$at" +%s 2>/dev/null) || return 1; fi
  if [[ "$on" =~ ^[0-9]+$ ]] && { [ -z "$ref" ] || [ "$on" -gt "$ref" ]; }; then ref=$on; fi
  printf '%s|%s' "$enabled" "$ref"
}

if [ "$TEST" = 1 ]; then
  if tick=$(read_tick) && [ -n "${tick#*|}" ]; then note="последний тик $((NOW - ${tick#*|})) с назад"; else note="тик не прочитан"; fi
  tg "🧪 проверка связи сторожа ($note)" && echo "Пробное сообщение отправлено ($note)"
  exit $?
fi

# Состояние: только целые числа ключ=значение.
tick_alerted=0 tick_since=0 tick_restart=0 site_fails=0 site_since=0 site_alerted=0
if [ -f "$STATE" ]; then
  while IFS='=' read -r k v; do
    [[ "$v" =~ ^(0|[1-9][0-9]*)$ ]] || continue
    case "$k" in tick_alerted | tick_since | tick_restart | site_fails | site_since | site_alerted) printf -v "$k" '%s' "$v" ;; esac
  done <"$STATE"
fi
report=()

# --- Сайт ---
code=$("$CURL" -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL" 2>/dev/null) || true
if "$SYSTEMCTL" is-active --quiet "$SERVICE" && [[ "$code" =~ ^[234][0-9][0-9]$ ]]; then
  [ "$site_alerted" = 1 ] && tg "✅ сайт снова отвечает (простой ~$(mins $((NOW - site_since))) мин)"
  site_fails=0 site_since=0 site_alerted=0
  report+=("сайт ok")
else
  site_fails=$((site_fails + 1))
  [ "$site_since" = 0 ] && site_since=$NOW
  if [ "$site_fails" -ge "$SITE_FAILS" ] && [ "$site_alerted" != 1 ]; then
    tg "⚠️ сайт не отвечает ~$(mins $((NOW - site_since))) мин (сервис: $("$SYSTEMCTL" is-active "$SERVICE" 2>/dev/null || true), HTTP: ${code:-нет ответа})" &&
      site_alerted=1
  fi
  report+=("сайт НЕ ОТВЕЧАЕТ (${site_fails}-я проверка, HTTP ${code:-—})")
fi

# --- Тик ---
if ! tick=$(read_tick); then
  report+=("тик не прочитан из $DB")
elif [ "${tick%%|*}" != true ]; then
  [ "$tick_alerted" = 1 ] && tg "ℹ️ автоторговля выключена — тик больше не проверяется"
  tick_alerted=0 tick_since=0
  report+=("автоторговля выключена")
else
  at=${tick#*|}
  no_ref=0
  if [ -z "$at" ]; then
    # Ни тика, ни отметки включения: возраст — от первого наблюдения сторожем (tick_since копится, не сбрасывается).
    no_ref=1
    [ "$tick_since" = 0 ] && tick_since=$NOW
    at=$tick_since
    last="тиков ещё не было"
  else
    last="последний $(hhmm "$at") UTC"
  fi
  age=$((NOW - at))
  if [ "$age" -le "$TICK_ALERT_S" ] && [ "$no_ref" = 1 ]; then
    report+=("тиков ещё не было, наблюдаю ${age} с")
  elif [ "$age" -le "$TICK_ALERT_S" ]; then
    [ "$tick_alerted" = 1 ] && tg "✅ тик снова идёт (стоял ~$(mins $((at - tick_since))) мин, с $(hhmm "$tick_since") UTC)"
    tick_alerted=0 tick_since=0
    report+=("тик ${age} с назад")
  else
    [ "$tick_since" = 0 ] && tick_since=$at
    if [ "$tick_alerted" != 1 ]; then
      tg "⚠️ тик не идёт ~$(mins "$age") мин ($last); через $(mins "$TICK_RESTART_S") мин простоя — перезапуск сервиса" &&
        tick_alerted=1
    fi
    if [ "$age" -ge "$TICK_RESTART_S" ] && [ $((NOW - tick_restart)) -ge "$RESTART_EVERY_S" ]; then
      if "$SYSTEMCTL" restart "$SERVICE"; then
        tg "🔄 перезапустил сервис: тик стоял ~$(mins "$age") мин ($last). Прерванный прогон демо-зеркала — сверить строки pending"
        report+=("ПЕРЕЗАПУСК: тик стоял ${age} с")
      else
        tg "❌ не удалось перезапустить сервис (тик стоит ~$(mins "$age") мин)"
        report+=("перезапуск не удался")
      fi
      tick_restart=$NOW
    else
      report+=("ТИК СТОИТ ${age} с")
    fi
  fi
fi

mkdir -p "$STATE_DIR"
printf 'tick_alerted=%s\ntick_since=%s\ntick_restart=%s\nsite_fails=%s\nsite_since=%s\nsite_alerted=%s\n' \
  "$tick_alerted" "$tick_since" "$tick_restart" "$site_fails" "$site_since" "$site_alerted" >"$STATE.part" && mv -f "$STATE.part" "$STATE"
(IFS=';'; echo "Сторож: ${report[*]}")
