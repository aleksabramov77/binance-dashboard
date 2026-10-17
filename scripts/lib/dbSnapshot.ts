// Проверка и установка скачанного снимка базы (`pnpm db:pull`, spec 0059): `<out>.part` → `out`. Снимок проверяется
// до замены прежнего; любой сбой — `.part` с хвостами удаляется, прежний `out` цел. Рядом с `out` мусора не остаётся.
import { renameSync, rmSync } from "node:fs";
import Database from "better-sqlite3";

const removeDb = (file: string) => {
  for (const f of [file, `${file}-wal`, `${file}-shm`])
    rmSync(f, { force: true });
};

/**
 * Проверяет `part` (`quick_check`, таблица experiments есть) и ставит его на место `out`. Журнал снимка переводится в
 * DELETE — один самодостаточный файл без -wal/-shm. Возвращает число экспериментов; сбой — Error с понятным текстом.
 */
export function installSnapshot(
  part: string,
  out: string,
): { experiments: number } {
  let experiments: number;
  try {
    const db = new Database(part, { fileMustExist: true });
    try {
      db.pragma("journal_mode = DELETE");
      const ok = db.pragma("quick_check", { simple: true });
      if (ok !== "ok") throw new Error(`quick_check: ${String(ok)}`);
      const row = db.prepare("select count(*) as n from experiments").get() as
        | { n: number }
        | undefined;
      experiments = row?.n ?? 0;
    } finally {
      db.close();
    }
  } catch (error) {
    removeDb(part);
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(
      `скачанный файл — не исправная база приложения (${why}); прежний ${out} не тронут`,
    );
  }
  removeDb(out);
  renameSync(part, out);
  removeDb(`${part}`);
  return { experiments };
}
