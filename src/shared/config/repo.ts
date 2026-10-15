/** Репозиторий проекта на GitHub — ссылки на документацию со страницы /help. */
export const REPO_URL = "https://github.com/aleksabramov77/binance-dashboard";

/** Ссылка на файл репозитория в main: docUrl("docs/ai/glossary.md"). */
export const docUrl = (relativePath: string) =>
  `${REPO_URL}/blob/main/${relativePath}`;
