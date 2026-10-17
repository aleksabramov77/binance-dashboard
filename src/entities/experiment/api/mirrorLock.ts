import { type LockedResult, tryWithProcessLock } from "./processLock.ts";

// Блокировка прогона demo-зеркала (spec 0012, PR 2e; spec 0059): бюджет прогона 200 с больше минуты таймера, два
// прогона одновременно открыли бы один вход дважды или закрыли бы чужое. База — файл SQLite одного процесса,
// поэтому блокировка — в памяти процесса. Без @/… и node:* (как tickLock).

const MIRROR_RUN_LOCK = "demo-mirror-run";

/**
 * Выполняет fn, если прогон зеркала в этом процессе больше не идёт. Не взяли — fn не вызывается
 * (`acquired: false`): следующий прогон через минуту.
 */
export function withMirrorRunLock<T>(
  fn: () => Promise<T>,
): Promise<LockedResult<T>> {
  return tryWithProcessLock(MIRROR_RUN_LOCK, fn);
}
