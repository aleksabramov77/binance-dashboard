// GitHub REST: задачи (issues) одного репозитория. Только сервер (токен). Без доменных слов —
// что писать в задачах, решает вызывающий код.
import { z } from "zod";

const API = "https://api.github.com";
/** Одна страница списка: для репозитория задач уведомлений этого хватает. */
const PER_PAGE = 100;

export interface GithubRepoConfig {
  /** Fine-grained PAT с правом Issues: Read and write на этот репозиторий. */
  token: string;
  owner: string;
  repo: string;
}

const issueSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  created_at: z.string(),
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string() }).loose()]))
    .default([]),
  /** Есть у pull request — список задач GitHub отдаёт их вместе с issues. */
  pull_request: z.unknown().optional(),
});
const issueListSchema = z.array(issueSchema);
const labelListSchema = z.array(z.object({ name: z.string() }).loose());
const createdSchema = z.object({ number: z.number(), html_url: z.string() });
const errorSchema = z.object({ message: z.string() }).loose();

export interface GithubIssue {
  number: number;
  url: string;
  title: string;
  body: string;
  createdAt: string;
  labels: string[];
}

export interface GithubLabel {
  name: string;
  /** Цвет без «#», 6 hex-символов. */
  color: string;
  description?: string;
}

/** Запрос к REST API; ошибка — со статусом и сообщением GitHub (без токена). */
async function request<T extends z.ZodType>(
  cfg: GithubRepoConfig,
  method: "GET" | "POST",
  path: string,
  schema: T,
  payload?: Record<string, unknown>,
): Promise<z.infer<T>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new Error(
      `GitHub ${method} ${path.split("?")[0]} ${res.status}: ${parsed.success ? parsed.data.message : res.statusText}`,
    );
  }
  return schema.parse(json);
}

const repoPath = (cfg: GithubRepoConfig) =>
  `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

function toIssue(raw: z.infer<typeof issueSchema>): GithubIssue {
  return {
    number: raw.number,
    url: raw.html_url,
    title: raw.title,
    body: raw.body ?? "",
    createdAt: raw.created_at,
    labels: raw.labels.map((l) => (typeof l === "string" ? l : l.name)),
  };
}

const onlyIssues = (list: z.infer<typeof issueListSchema>) =>
  list.filter((i) => i.pull_request === undefined).map(toIssue);

/** Открытые задачи репозитория, свежие первыми (до 100, без pull request). */
export async function listOpenIssues(
  cfg: GithubRepoConfig,
): Promise<GithubIssue[]> {
  return onlyIssues(
    await request(
      cfg,
      "GET",
      `${repoPath(cfg)}/issues?state=open&sort=created&direction=desc&per_page=${PER_PAGE}`,
      issueListSchema,
    ),
  );
}

/** Сколько задач с меткой создано не раньше since (открытых и закрытых). */
export async function countIssuesCreatedSince(
  cfg: GithubRepoConfig,
  label: string,
  since: Date,
): Promise<number> {
  // since у GitHub — по времени изменения: созданные позже точно попадут, остальное отсеиваем сами.
  const list = onlyIssues(
    await request(
      cfg,
      "GET",
      `${repoPath(cfg)}/issues?state=all&labels=${encodeURIComponent(label)}&since=${encodeURIComponent(since.toISOString())}&per_page=${PER_PAGE}`,
      issueListSchema,
    ),
  );
  return list.filter((i) => Date.parse(i.createdAt) >= since.getTime()).length;
}

/** Создать недостающие метки репозитория. */
export async function ensureLabels(
  cfg: GithubRepoConfig,
  labels: readonly GithubLabel[],
): Promise<void> {
  const existing = new Set(
    (
      await request(
        cfg,
        "GET",
        `${repoPath(cfg)}/labels?per_page=${PER_PAGE}`,
        labelListSchema,
      )
    ).map((l) => l.name.toLowerCase()),
  );
  for (const label of labels)
    if (!existing.has(label.name.toLowerCase()))
      await request(cfg, "POST", `${repoPath(cfg)}/labels`, z.unknown(), {
        name: label.name,
        color: label.color,
        description: label.description ?? "",
      });
}

/** Создать задачу. */
export async function createIssue(
  cfg: GithubRepoConfig,
  input: { title: string; body: string; labels: string[] },
): Promise<{ number: number; url: string }> {
  const created = await request(
    cfg,
    "POST",
    `${repoPath(cfg)}/issues`,
    createdSchema,
    {
      // Лимиты GitHub: заголовок до 256, тело до 65 536 символов.
      title: input.title.slice(0, 250),
      body: input.body.slice(0, 60_000),
      labels: input.labels,
    },
  );
  return { number: created.number, url: created.html_url };
}

/** Комментарий в задачу. */
export async function commentIssue(
  cfg: GithubRepoConfig,
  issueNumber: number,
  body: string,
): Promise<void> {
  await request(
    cfg,
    "POST",
    `${repoPath(cfg)}/issues/${issueNumber}/comments`,
    z.unknown(),
    { body: body.slice(0, 60_000) },
  );
}
