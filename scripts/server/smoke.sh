#!/usr/bin/env bash
# Смоук прода на VM apps-tokyo (spec 0061, этап smoke в .config/flows/release.yaml). Запуск с Mac:
#   ssh -i ~/.ssh/lightsail_apps_tokyo -o IdentitiesOnly=yes claude@<ip> 'bash -s' < scripts/server/smoke.sh
# Проверяет по базе SQLite (spec 0059), а не по Supabase: последний тик не старше 150 с, раннер oracle, статус ok;
# сервис binance активен; binance-live — активен, если включён; последняя ночная копия базы не старше 26 ч (spec 0062). Код выхода 1 — что-то не так (причина в выводе).
set -uo pipefail

DB=/var/lib/binance/app.db
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "FAIL: $*"; fail=1; }

if systemctl is-active --quiet binance; then say "OK: binance active"; else bad "binance не активен"; fi

tick=$(sudo -u binance sqlite3 -readonly "$DB" "select coalesce(json_extract(value, '\$.at'), '') || '|' ||
  coalesce(json_extract(value, '\$.runner'), '') || '|' || coalesce(json_extract(value, '\$.status'), '')
  from engine_state where key = 'last_tick'") || { bad "sqlite3 не прочитал $DB"; tick=""; sqlite_failed=1; }
IFS='|' read -r at runner status <<<"$tick"
# Пустую строку GNU date не отвергает (полночь), поэтому время разбирается только непустое.
at_s=""
[ -z "${at:-}" ] || at_s=$(date -d "$at" +%s 2>/dev/null || true)
if [ "${sqlite_failed:-0}" = 1 ]; then
  :
elif [ -z "$tick" ]; then
  bad "в engine_state нет last_tick"
elif [ -z "$at_s" ]; then
  bad "в last_tick нет времени тика (at='${at:-}')"
else
  age=$(($(date +%s) - at_s))
  say "тик: $at (${age} с назад), runner=$runner, status=$status"
  [ "$age" -le 150 ] || bad "последний тик старше 150 с"
  [ "$age" -ge -60 ] || bad "время тика в будущем — часы VM или запись тика неверны"
  [ "$runner" = oracle ] || bad "runner=$runner, ожидается oracle"
  [ "$status" = ok ] || bad "status=$status, ожидается ok"
fi

# Ночная копия базы (spec 0062): каталог 700 у binance — читаем от его имени. Копий ещё нет — предупреждение.
latest=$(sudo -u binance find /var/lib/binance/backups -maxdepth 1 -name 'app-????-??-??.db.gz' -printf '%T@ %f\n' 2>/dev/null | sort -n | tail -1)
if [ -z "$latest" ] && systemctl is-enabled --quiet binance-backup.timer; then
  bad "таймер binance-backup включён, а копий в /var/lib/binance/backups нет — sudo systemctl start binance-backup и журнал"
elif [ -z "$latest" ]; then
  say "WARN: ночных копий базы ещё нет — таймер binance-backup не установлен (add-backup.sh, spec 0062)"
else
  bk_age=$(($(date +%s) - ${latest%%.*}))
  say "копия базы: ${latest#* } ($((bk_age / 3600)) ч назад)"
  [ "$bk_age" -le $((26 * 3600)) ] || bad "последней копии базы больше 26 ч — проверь binance-backup.timer"
fi

# Сторож (spec 0064): таймер включён и последний запуск не старше 10 мин. Не установлен — предупреждение.
if systemctl is-enabled --quiet binance-watchdog.timer 2>/dev/null; then
  wd_last=$(systemctl show -p ExecMainExitTimestamp --value binance-watchdog.service)
  wd_s=""
  [ -z "$wd_last" ] || [ "$wd_last" = n/a ] || wd_s=$(date -d "$wd_last" +%s 2>/dev/null || true)
  if [ -z "$wd_s" ]; then
    bad "сторож binance-watchdog ещё ни разу не запускался"
  elif [ $(($(date +%s) - wd_s)) -gt 600 ]; then
    bad "сторож binance-watchdog не запускался больше 10 мин"
  else
    say "OK: сторож запускался $(($(date +%s) - wd_s)) с назад ($(systemctl show -p Result --value binance-watchdog.service))"
  fi
else
  say "WARN: сторож binance-watchdog не установлен (add-watchdog.sh, spec 0064)"
fi

if systemctl is-enabled --quiet binance-live; then
  if systemctl is-active --quiet binance-live; then say "OK: binance-live active"; else bad "binance-live включён, но не активен"; fi
else
  say "binance-live выключен — не проверяется"
fi

exit "$fail"
