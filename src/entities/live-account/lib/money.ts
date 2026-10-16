/** «$10,05», «−$15,20», «+$0,84» — деньги для журнала и Telegram (без локали процесса). */
export function liveUsd(v: number, signed = false): string {
  const abs = `$${Math.abs(v).toFixed(2).replace(".", ",")}`;
  if (v < 0) return `−${abs}`;
  return signed && v > 0 ? `+${abs}` : abs;
}
