/**
 * Кэш одного значения в памяти процесса: свежее значение отдаётся без загрузки, параллельные
 * вызовы на холодный кэш ждут одну загрузку. `keep` решает, кэшировать ли результат (ошибки — нет).
 */
export function createTtlCache<T>(
  ttlMs: number,
  keep: (value: T) => boolean = () => true,
) {
  let cached: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  return {
    async get(load: () => Promise<T>, now = Date.now()): Promise<T> {
      if (cached && now - cached.at < ttlMs) return cached.value;
      inflight ??= load()
        .then((value) => {
          if (keep(value)) cached = { at: now, value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    clear() {
      cached = null;
    },
  };
}
