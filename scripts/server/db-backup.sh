#!/usr/bin/env bash
# Ночная копия базы проекта на VM apps-tokyo (spec 0062). На VM — /usr/local/bin/<проект>-db-backup, запускает
# <проект>-backup.service от пользователя проекта (ставит add-backup.sh). Шаги:
#   1. sqlite3 .backup — согласованная копия без остановки сервиса (WAL);
#   2. pragma integrity_check копии = ok, иначе ошибка;
#   3. gzip → backups/app-YYYY-MM-DD.db.gz (через .part, права 600; копия того же дня перезаписывается);
#   4. остаются KEEP последних копий; файлы журнала LOG_DIR старше LOG_DAYS дней удаляются.
# Итог — одна строка в stdout (journald); сбой — строка «ОШИБКА: …» в stderr и код выхода 1.
#   db-backup.sh [--db FILE] [--dir DIR] [--logs DIR] [--keep N] [--log-days N]
set -euo pipefail

DB=/var/lib/binance/app.db
DIR=/var/lib/binance/backups
LOGS=/var/lib/binance/logs
KEEP=7
LOG_DAYS=14
while [ $# -gt 0 ]; do
  case "$1" in --db | --dir | --logs | --keep | --log-days)
    [ $# -ge 2 ] || { echo "ОШИБКА: $1 — нужно значение" >&2; exit 1; } ;;
  esac
  case "$1" in
    --db) DB=$2; shift 2 ;;
    --dir) DIR=$2; shift 2 ;;
    --logs) LOGS=$2; shift 2 ;;
    --keep) KEEP=$2; shift 2 ;;
    --log-days) LOG_DAYS=$2; shift 2 ;;
    *) echo "ОШИБКА: неизвестный параметр $1" >&2; exit 1 ;;
  esac
done

fail() { echo "ОШИБКА: $*" >&2; rm -f "$PART" "$PART.gz"; exit 1; }
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "ОШИБКА: --keep — целое ≥ 1" >&2; exit 1; }
[[ "$LOG_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo "ОШИБКА: --log-days — целое ≥ 1" >&2; exit 1; }

started=$(date +%s)
day=$(date -u +%F)
umask 077
mkdir -p "$DIR" || { echo "ОШИБКА: не создать каталог копий $DIR" >&2; exit 1; }
OUT="$DIR/app-$day.db.gz"
PART="$DIR/.app-$day.db.part"
rm -f "$PART" "$PART.gz"

[ -f "$DB" ] || fail "нет базы $DB"
sqlite3 "$DB" ".backup '$PART'" || fail "sqlite3 .backup не удался"
check=$(sqlite3 "$PART" "pragma integrity_check" 2>&1) || fail "integrity_check не выполнился: $(printf '%s' "$check" | head -3 | tr '\n' ' ')"
[ "$check" = ok ] || fail "integrity_check копии: $(printf '%s' "$check" | head -3 | tr '\n' ' ')"
gzip -9 "$PART" || fail "gzip не удался"
chmod 600 "$PART.gz"
sync "$PART.gz" 2>/dev/null || sync
mv -f "$PART.gz" "$OUT"

# Ротация: имена с датой сортируются по времени; остаются KEEP последних.
mapfile -t old < <(find "$DIR" -maxdepth 1 -name 'app-????-??-??.db.gz' -printf '%f\n' | sort | head -n "-$KEEP")
for f in "${old[@]}"; do rm -f "$DIR/$f"; done

# Сбой чистки журнала копию не отменяет: итоговая строка печатается, но код выхода 1.
logs_removed=0
logs_failed=0
if [ -d "$LOGS" ]; then
  logs_removed=$(find "$LOGS" -maxdepth 1 -name 'app-*.jsonl' -mtime "+$((LOG_DAYS - 1))" -print -delete | wc -l) ||
    { echo "ОШИБКА: чистка журнала $LOGS не удалась (копия базы сделана)" >&2; logs_failed=1; }
fi

kept=$(find "$DIR" -maxdepth 1 -name 'app-????-??-??.db.gz' | wc -l)
echo "Копия базы: $OUT, $(du -k "$OUT" | cut -f1) КБ, integrity ok, за $(($(date +%s) - started)) с; копий $kept (хранится $KEEP), удалено копий ${#old[@]}, файлов журнала $logs_removed"
exit "$logs_failed"
