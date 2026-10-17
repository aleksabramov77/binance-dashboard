// Блокировка в памяти процесса (spec 0059): база — файл SQLite, процесс с ней один (сервис на VM), поэтому
// межпроцессные advisory lock Postgres больше не нужны. Состояние — в globalThis: в dev instrumentation и роуты —
// разные бандлы, а блокировка должна быть общей. Без @/… и node:* (как tickLock).

export type LockedResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

type GlobalWithLocks = typeof globalThis & {
  [key: symbol]: Set<string> | undefined;
};
const key = Symbol.for("binance-dashboard.processLocks");

function held(): Set<string> {
  const g = globalThis as GlobalWithLocks;
  g[key] ??= new Set();
  return g[key];
}

/**
 * Выполняет fn, если блокировка `name` свободна; занята — fn не вызывается (`acquired: false`), ждать не нужно.
 * Снимается, когда fn закончилась — успешно или с ошибкой.
 */
export async function tryWithProcessLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<LockedResult<T>> {
  const locks = held();
  if (locks.has(name)) return { acquired: false };
  locks.add(name);
  try {
    return { acquired: true, value: await fn() };
  } finally {
    locks.delete(name);
  }
}
