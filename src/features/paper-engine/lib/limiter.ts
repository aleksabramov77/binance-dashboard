/** Ограничитель параллельности: не больше n задач одновременно (бережём rate limit Binance). */
export function createLimiter(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  // Освободившееся место передаётся следующему в очереди напрямую — счётчик не превышает n.
  const release = () => {
    const wake = queue.shift();
    if (wake) wake();
    else active--;
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < n) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}
