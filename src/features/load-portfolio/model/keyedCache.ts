/**
 * Кэш одного значения по ключу в памяти процесса: пока ключ тот же — отдаёт ту же загрузку (и параллельным
 * вызовам тоже), новый ключ — загружает заново. Ошибка загрузки не кэшируется: следующий вызов попробует снова.
 */
export function createKeyedCache<K, T>() {
  let cached: { key: K; value: Promise<T> } | null = null;
  return {
    get(key: K, load: () => Promise<T>): Promise<T> {
      if (cached && Object.is(cached.key, key)) return cached.value;
      const entry = { key, value: load() };
      cached = entry;
      entry.value.catch(() => {
        if (cached === entry) cached = null;
      });
      return entry.value;
    },
  };
}
