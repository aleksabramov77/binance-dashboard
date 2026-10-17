#!/usr/bin/env bash
# Смоук прода на VM apps-tokyo (spec 0061, этап smoke в .config/flows/release.yaml). Запуск с Mac:
#   ssh -i ~/.ssh/lightsail_apps_tokyo -o IdentitiesOnly=yes claude@<ip> 'bash -s' < scripts/server/smoke.sh
# Проверяет по базе SQLite (spec 0059), а не по Supabase: последний тик не старше 150 с, раннер oracle, статус ok;
# сервис binance активен; binance-live — активен, если включён. Код выхода 1 — что-то не так (причина в выводе).
set -uo pipefail

DB=/var/lib/binance/app.db
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "FAIL: $*"; fail=1; }

if systemctl is-active --quiet binance; then say "OK: binance active"; else bad "binance не активен"; fi

tick=$(sudo -u binance sqlite3 -readonly "$DB" "select coalesce(json_extract(value, '\$.at'), '') || '|' ||
  coalesce(json_extract(value, '\$.runner'), '') || '|' || coalesce(json_extract(value, '\$.status'), '')
  from engine_state where key = 'last_tick'")
IFS='|' read -r at runner status <<<"$tick"
at_s=$(date -d "${at:-x}" +%s 2>/dev/null || true)
if [ -z "$tick" ]; then
  bad "в engine_state нет last_tick"
elif [ -z "$at_s" ]; then
  bad "в last_tick нет времени тика (at='${at:-}')"
else
  age=$(($(date +%s) - at_s))
  say "тик: $at (${age} с назад), runner=$runner, status=$status"
  [ "$age" -le 150 ] || bad "последний тик старше 150 с"
  [ "$runner" = oracle ] || bad "runner=$runner, ожидается oracle"
  [ "$status" = ok ] || bad "status=$status, ожидается ok"
fi

if systemctl is-enabled --quiet binance-live; then
  if systemctl is-active --quiet binance-live; then say "OK: binance-live active"; else bad "binance-live включён, но не активен"; fi
else
  say "binance-live выключен — не проверяется"
fi

exit "$fail"
