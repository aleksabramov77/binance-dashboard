#!/usr/bin/env bash
# Сторож прода на VM apps-tokyo (spec 0064): отдельный от приложения процесс (bash + sqlite3 + curl), его запускает
# binance-watchdog.timer каждые 2 мин (ставит add-watchdog.sh). Код приложения не используется — зависание приложения
# (2026-10-16: тик, демо-зеркало и монитор висели ~5 ч) сторожа не задевает.
#   - тик: автоторговля включена (engine_state.enabled), а last_tick старше TICK_ALERT_S → тревога в Telegram;
#     старше TICK_RESTART_S → systemctl restart сервиса, не чаще RESTART_EVERY_S;
#   - сайт: сервис активен и 127.0.0.1:5000 отвечает (< 500) за 10 с; SITE_FAILS неудач подряд → тревога;
#   - на эпизод одно сообщение; восстановление — сообщение с длительностью простоя. Состояние — STATE_DIR/state.
#   - сообщения — в тему «🖥 Сервер» группы (TELEGRAM_TOPIC_SERVER из env-файла; нет — в чат без темы, spec 0067):
#     тревоги и перезапуск — со звуком, восстановление и пробное — тихо (disable_notification).
#   watchdog.sh [--test] [--db FILE] [--env-file FILE] [--state-dir DIR] [--url URL] [--service NAME]
# --test — пробное сообщение в Telegram (в тему «Сервер»), без проверок и перезапуска.
# Для проверки без прода: WATCHDOG_SYSTEMCTL / WATCHDOG_CURL — заглушки вместо systemctl / curl,
# WATCHDOG_TG_LOG=<файл> — сообщения с темой и звуком пишутся в файл, а не в Telegram, WATCHDOG_NOW=<unix-время> — «сейчас».
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

# Тема «Сервер» (message_thread_id) из env-файла; не задана или не число — пусто (сообщение в чат без темы).
server_topic() {
  local t
  t=$(env_value TELEGRAM_TOPIC_SERVER)
  [[ "$t" =~ ^[1-9][0-9]*$ ]] && printf '%s' "$t"
  return 0
}

# Где сообщение: «тема N» или «без темы».
topic_label() { if [ -n "$1" ]; then printf 'тема %s' "$1"; else printf 'без темы'; fi; }

# Сообщение в Telegram: tg loud|quiet "текст" — тревога со звуком или тихо (восстановление). Токен — через stdin
# (`--config -`): аргументы процесса видны в списке процессов.
tg() {
  local sound=$1 text="🛡 $SERVICE: $2" topic
  topic=$(server_topic)
  if [ -n "${WATCHDOG_TG_LOG:-}" ]; then
    printf '[%s · %s] %s\n' "$(topic_label "$topic")" "$([ "$sound" = quiet ] && echo тихо || echo со звуком)" "$text" >>"$WATCHDOG_TG_LOG"
    return 0
  fi
  local token chat extra=()
  token=$(env_value TELEGRAM_BOT_TOKEN)
  chat=$(env_value TELEGRAM_CHAT_ID)
  if [ -z "$token" ] || [ -z "$chat" ]; then echo "Telegram не настроен ($ENV_FILE): $text"; return 1; fi
  [ -n "$topic" ] && extra+=(--data-urlencode "message_thread_id=$topic")
  [ "$sound" = quiet ] && extra+=(--data-urlencode "disable_notification=true")
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
    "$CURL" -s -o /dev/null -w '%{http_code}' --max-time 15 --config - \
      --data-urlencode "chat_id=$chat" ${extra[@]+"${extra[@]}"} --data-urlencode "text=$text" | grep -q '^200$' ||
    { echo "Telegram не принял сообщение: $text"; return 1; }
}

mins() { echo $((($1 + 59) / 60)); }
hhmm() { date -u -d "@$1" +%H:%M; }

# Тик: «enabled|ref_unix|tick_unix», где ref — последний тик или включение автоторговли, что позже (пока автоторговля выключена,
# тик last_tick не пишет: после включения его возраст — от момента включения). ref пустой — ни тика, ни отметки.
read_tick() {
  local row enabled at on ref=""
  row=$(sqlite3 -readonly -cmd ".timeout 5000" "$DB" "select coalesce((select value from engine_state where key = 'enabled'), '') || '|' ||
    coalesce((select json_extract(value, '\$.at') from engine_state where key = 'last_tick'), '') || '|' ||
    coalesce((select updated_at / 1000 from engine_state where key = 'enabled'), '')") || return 1
  IFS='|' read -r enabled at on <<<"$row"
  local tick_s=""
  if [ -n "$at" ]; then tick_s=$(date -d "$at" +%s 2>/dev/null) || return 1; fi
  ref=$tick_s
  if [[ "$on" =~ ^[0-9]+$ ]] && { [ -z "$ref" ] || [ "$on" -gt "$ref" ]; }; then ref=$on; fi
  printf '%s|%s|%s' "$enabled" "$ref" "$tick_s"
}

if [ "$TEST" = 1 ]; then
  note="тик не прочитан"
  if tick=$(read_tick); then
    IFS='|' read -r _ _ t_s <<<"$tick"
    if [ -n "$t_s" ]; then note="последний тик $((NOW - t_s)) с назад"; else note="тиков ещё не было"; fi
  fi
  tg quiet "🧪 проверка связи сторожа ($note)" && echo "Пробное сообщение отправлено ($(topic_label "$(server_topic)"), тихо; $note)"
  exit $?
fi

# Состояние: только целые числа ключ=значение.
db_alerted=0 tick_alerted=0 tick_since=0 tick_restart=0 site_fails=0 site_since=0 site_alerted=0
if [ -f "$STATE" ]; then
  while IFS='=' read -r k v; do
    [[ "$v" =~ ^(0|[1-9][0-9]*)$ ]] || continue
    case "$k" in db_alerted | tick_alerted | tick_since | tick_restart | site_fails | site_since | site_alerted) printf -v "$k" '%s' "$v" ;; esac
  done <"$STATE"
fi
report=()

# --- Сайт ---
code=$("$CURL" -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL" 2>/dev/null) || true
if "$SYSTEMCTL" is-active --quiet "$SERVICE" && [[ "$code" =~ ^[234][0-9][0-9]$ ]]; then
  [ "$site_alerted" = 1 ] && tg quiet "✅ сайт снова отвечает (простой ~$(mins $((NOW - site_since))) мин)"
  site_fails=0 site_since=0 site_alerted=0
  report+=("сайт ok")
else
  site_fails=$((site_fails + 1))
  [ "$site_since" = 0 ] && site_since=$NOW
  if [ "$site_fails" -ge "$SITE_FAILS" ] && [ "$site_alerted" != 1 ]; then
    tg loud "⚠️ сайт не отвечает ~$(mins $((NOW - site_since))) мин (сервис: $("$SYSTEMCTL" is-active "$SERVICE" 2>/dev/null || true), HTTP: ${code:-нет ответа})" &&
      site_alerted=1
  fi
  report+=("сайт НЕ ОТВЕЧАЕТ (${site_fails}-я проверка, HTTP ${code:-—})")
fi

# --- Тик ---
tick_ok=1
tick=$(read_tick) || tick_ok=0
if [ "$tick_ok" = 1 ] && [ "$db_alerted" = 1 ]; then
  tg quiet "✅ сторож снова читает базу" || true
  db_alerted=0
fi
if [ "$tick_ok" = 0 ]; then
  # Сторож без базы слеп: одно сообщение на эпизод.
  [ "$db_alerted" = 1 ] || { tg loud "⚠️ сторож не может прочитать базу $DB — тик не проверяется" && db_alerted=1; }
  report+=("тик не прочитан из $DB")
elif [ "${tick%%|*}" != true ]; then
  [ "$tick_alerted" = 1 ] && tg quiet "ℹ️ автоторговля выключена — тик больше не проверяется"
  tick_alerted=0 tick_since=0
  report+=("автоторговля выключена")
else
  IFS='|' read -r _ at real_tick <<<"$tick"
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
  elif [ "$age" -le "$TICK_ALERT_S" ] && [ "$tick_alerted" = 1 ] && [ "${real_tick:-0}" -le "$tick_since" ]; then
    # Свежая только отметка включения (автоторговлю переключили во время эпизода), нового тика нет — эпизод идёт.
    report+=("автоторговля переключена, тика после простоя ещё нет")
  elif [ "$age" -le "$TICK_ALERT_S" ]; then
    [ "$tick_alerted" = 1 ] && tg quiet "✅ тик снова идёт (стоял ~$(mins $((at - tick_since))) мин, с $(hhmm "$tick_since") UTC)"
    tick_alerted=0 tick_since=0
    report+=("тик ${age} с назад")
  else
    [ "$tick_since" = 0 ] && tick_since=$at
    if [ "$tick_alerted" != 1 ]; then
      tg loud "⚠️ тик не идёт ~$(mins "$age") мин ($last); через $(mins "$TICK_RESTART_S") мин простоя — перезапуск сервиса" &&
        tick_alerted=1
    fi
    if [ "$age" -ge "$TICK_RESTART_S" ] && [ $((NOW - tick_restart)) -ge "$RESTART_EVERY_S" ]; then
      if "$SYSTEMCTL" restart "$SERVICE"; then
        tg loud "🔄 перезапустил сервис: тик стоял ~$(mins "$age") мин ($last). Прерванный прогон демо-зеркала — сверить строки pending"
        report+=("ПЕРЕЗАПУСК: тик стоял ${age} с")
      else
        tg loud "❌ не удалось перезапустить сервис (тик стоит ~$(mins "$age") мин)"
        report+=("перезапуск не удался")
      fi
      tick_restart=$NOW
    else
      report+=("ТИК СТОИТ ${age} с")
    fi
  fi
fi

mkdir -p "$STATE_DIR"
printf 'db_alerted=%s\ntick_alerted=%s\ntick_since=%s\ntick_restart=%s\nsite_fails=%s\nsite_since=%s\nsite_alerted=%s\n' \
  "$db_alerted" "$tick_alerted" "$tick_since" "$tick_restart" "$site_fails" "$site_since" "$site_alerted" >"$STATE.part" &&
  mv -f "$STATE.part" "$STATE" ||
  { echo "ОШИБКА: состояние не записано в $STATE — повторные сообщения и перезапуск чаще раза в час" >&2; state_failed=1; }
(IFS=';'; echo "Сторож: ${report[*]}")
exit "${state_failed:-0}"
