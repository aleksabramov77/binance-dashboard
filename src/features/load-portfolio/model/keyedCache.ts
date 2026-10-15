/**
 * Кэш одного значения по ключу в памяти процесса: пока ключ тот же и срок не истёк — отдаёт ту же загрузку (и
 * параллельным вызовам тоже); новый ключ или истёкший срок — загружает заново. Срок (`ttlMs`) отсчитывается от начала
 * загрузки. Ошибка загрузки не кэшируется: следующий вызов попробует снова.
 */
export function createKeyedCache<K, T>() {
  let cached: { key: K; value: Promise<T>; expiresAt: number } | null = null;
  return {
    get(
      key: K,
      load: () => Promise<T>,
      { now = Date.now(), ttlMs = Number.POSITIVE_INFINITY } = {},
    ): Promise<T> {
      if (cached && Object.is(cached.key, key) && now < cached.expiresAt)
        return cached.value;
      const entry = { key, value: load(), expiresAt: now + ttlMs };
      cached = entry;
      entry.value.catch(() => {
        if (cached === entry) cached = null;
      });
      return entry.value;
    },
  };
}
