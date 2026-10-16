/** Запись журнала о сбое задач в GitHub (spec 0037): композиция пишет её через log.warn. */
export interface GithubWarning {
  event: "monitor.github";
  message: string;
  data: { repo: string | null };
}

/**
 * Что записать в журнал после прогона: нераспознанные настройки GITHUB_ALERTS_* и сбои GitHub по тревогам.
 * Чистая функция; пустой массив — писать нечего.
 */
export function githubWarnings(input: {
  /** Имена переменных с нераспознанным значением. */
  invalid: string[];
  /** Сбои GitHub из результата прогона. */
  errors: string[];
  /** owner/name; null — GitHub не настроен. */
  repo: string | null;
}): GithubWarning[] {
  const data = { repo: input.repo };
  const out: GithubWarning[] = [];
  if (input.invalid.length)
    out.push({
      event: "monitor.github",
      message: `Не распознаны ${input.invalid.join(", ")} — взяты значения по умолчанию`,
      data,
    });
  if (input.errors.length)
    out.push({
      event: "monitor.github",
      message: `Сбой GitHub, задачи по тревогам: ${input.errors.join("; ")}`,
      data,
    });
  return out;
}
