/** Последние 4 символа API Key — всё, что о ключе видно после сохранения (карточка, журнал). */
export const keyHint = (apiKey: string): string => apiKey.trim().slice(-4);

/** «…AB12». */
export const hintText = (hint: string): string => `…${hint}`;

/**
 * Убирает ключ и секрет из текста (ошибка Binance или сети перед журналом и ответом API). Пустые и короткие строки не
 * заменяются — иначе «вычистились» бы обычные слова.
 */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets)
    if (secret.length >= 8) out = out.split(secret).join("***");
  return out;
}
