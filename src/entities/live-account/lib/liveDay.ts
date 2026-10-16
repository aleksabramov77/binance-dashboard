// Сутки дневного лимита — UTC (spec 0049): начало суток и следующая полночь.

export const utcDayStart = (now: number): Date => {
  const d = new Date(now);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
};

export const nextUtcMidnight = (now: number): Date =>
  new Date(utcDayStart(now).getTime() + 24 * 60 * 60_000);
