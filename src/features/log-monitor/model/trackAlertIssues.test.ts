import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue, MonitorSnapshot } from "../lib/detectIssues";
import type { AlertRow } from "../lib/planAlerts";
import { type MonitorDeps, runMonitor } from "./runMonitor";
import {
  type AlertIssuesConfig,
  type TrackIssuesInput,
  trackAlertIssues,
} from "./trackAlertIssues";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const H = 3_600_000;
const CFG: AlertIssuesConfig = {
  token: "test-token",
  owner: "me",
  repo: "alerts",
  autofixPerDay: 3,
};
const REPO = "https://github.com/me/alerts";

interface FakeIssue {
  number: number;
  html_url: string;
  title: string;
  body: string;
  created_at: string;
  labels: { name: string }[];
  state: "open" | "closed";
}

/** GitHub REST в памяти: задачи, метки, комментарии; fail — все ответы 500. */
function fakeGithub(
  opts: { issues?: FakeIssue[]; labels?: string[]; fail?: boolean } = {},
) {
  const issues = [...(opts.issues ?? [])];
  const labels = new Set(opts.labels ?? []);
  const comments: { number: number; body: string }[] = [];
  const created: FakeIssue[] = [];
  const calls: { method: string; url: string }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url });
    if (opts.fail)
      return Response.json({ message: "Server Error" }, { status: 500 });
    const u = new URL(url);
    const path = u.pathname.replace("/repos/me/alerts", "");
    if (method === "GET" && path === "/issues") {
      const state = u.searchParams.get("state");
      const label = u.searchParams.get("labels");
      const perPage = Number(u.searchParams.get("per_page") ?? 30);
      const page = Number(u.searchParams.get("page") ?? 1);
      return Response.json(
        issues
          .filter(
            (i) =>
              (state === "all" || i.state === state) &&
              (!label || i.labels.some((l) => l.name === label)),
          )
          .slice((page - 1) * perPage, page * perPage),
      );
    }
    if (method === "GET" && path === "/labels")
      return Response.json([...labels].map((name) => ({ name })));
    if (method === "POST" && path === "/labels") {
      labels.add(body.name);
      return Response.json(body, { status: 201 });
    }
    if (method === "POST" && path === "/issues") {
      const number = 1000 + created.length;
      const fresh: FakeIssue = {
        number,
        html_url: `${REPO}/issues/${number}`,
        title: body.title,
        body: body.body,
        created_at: new Date(NOW).toISOString(),
        labels: body.labels.map((name: string) => ({ name })),
        state: "open",
      };
      issues.push(fresh);
      created.push(fresh);
      return Response.json(
        { number, html_url: `${REPO}/issues/${number}` },
        { status: 201 },
      );
    }
    const comment = path.match(/^\/issues\/(\d+)\/comments$/);
    if (method === "POST" && comment) {
      comments.push({ number: Number(comment[1]), body: body.body });
      return Response.json({ id: 1 }, { status: 201 });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    issues,
    labels,
    comments,
    calls,
    created: () => created,
  };
}

const alertIssue = (n: number, patch: Partial<FakeIssue> = {}): FakeIssue => ({
  number: n,
  html_url: `${REPO}/issues/${n}`,
  title: `старая ${n}`,
  body: "",
  created_at: new Date(NOW - H).toISOString(),
  labels: [{ name: "alert" }],
  state: "closed",
  ...patch,
});

const issue: Issue = {
  key: "http5xx:/api/x",
  severity: "critical",
  title: "Ручка /api/x отвечает ошибками",
  details: "5 ответов 5xx за 15 мин",
  match: { path: "/api/x" },
};
const input = (patch: Partial<TrackIssuesInput> = {}) => ({
  notify: [issue],
  fresh: [issue.key],
  analysis: "Упал Binance.",
  samples: [
    {
      ts: "2026-10-16T11:59:00.000Z",
      level: "error",
      event: "http",
      message: "GET /api/x → 500",
      error: "fetch failed",
    },
    { ts: "t", level: "error", event: "other", message: "чужое" },
  ],
  logsUrl: "https://example.test/logs",
  now: NOW,
  ...patch,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trackAlertIssues", () => {
  it("новая тревога — одна задача с меткой alert, маркером, разбором и журналом; метки заводятся", async () => {
    const gh = fakeGithub({ labels: ["alert"] });
    const r = await trackAlertIssues(CFG, input());
    expect(r).toEqual({
      tracked: [
        { key: issue.key, action: "created", url: `${REPO}/issues/1000` },
      ],
      errors: [],
    });
    const [created] = gh.created();
    expect(gh.created()).toHaveLength(1);
    expect(created.labels).toEqual([{ name: "alert" }]);
    expect(created.title).toBe(issue.title);
    expect(created.body).toContain("<!-- alert:http5xx:/api/x -->");
    expect(created.body).toContain("5 ответов 5xx за 15 мин");
    expect(created.body).toContain("Упал Binance.");
    expect(created.body).toContain("GET /api/x → 500 (fetch failed)");
    expect(created.body).not.toContain("чужое");
    expect(created.body).toContain("https://example.test/logs");
    expect([...gh.labels].sort()).toEqual([
      "alert",
      "alert-no-code",
      "alert-pr",
      "alert-queued",
    ]);
    expect(gh.calls.every((c) => !c.url.includes("test-token"))).toBe(true);
  });

  it("открытая задача с тем же маркером — комментарий «повтор», новой нет", async () => {
    const gh = fakeGithub({
      issues: [
        alertIssue(7, {
          state: "open",
          body: "<!-- alert:http5xx:/api/x -->\nтекст",
        }),
      ],
    });
    const r = await trackAlertIssues(CFG, input({ fresh: [] }));
    expect(r.tracked).toEqual([
      { key: issue.key, action: "commented", url: `${REPO}/issues/7` },
    ]);
    expect(gh.created()).toEqual([]);
    expect(gh.comments).toEqual([
      {
        number: 7,
        body: "повтор: 5 ответов 5xx за 15 мин\n2026-10-16T12:00:00.000Z",
      },
    ]);
  });

  it("открытых задач больше страницы — своя на второй странице находится, дубликата нет", async () => {
    const many = Array.from({ length: 150 }, (_, k) =>
      alertIssue(k + 1, { state: "open", body: `<!-- alert:other:${k} -->` }),
    );
    many[120].body = "<!-- alert:http5xx:/api/x -->";
    const gh = fakeGithub({ issues: many });
    const r = await trackAlertIssues(CFG, input());
    expect(r.tracked).toEqual([
      { key: issue.key, action: "commented", url: `${REPO}/issues/121` },
    ]);
    expect(gh.created()).toEqual([]);
  });

  it("задача из очереди (alert-queued) тоже находится по маркеру", async () => {
    const gh = fakeGithub({
      issues: [
        alertIssue(9, {
          state: "open",
          labels: [{ name: "alert-queued" }],
          body: "<!-- alert:http5xx:/api/x -->",
        }),
      ],
    });
    const r = await trackAlertIssues(CFG, input({ fresh: [] }));
    expect(r.tracked[0]).toMatchObject({ action: "commented" });
    expect(gh.comments[0].number).toBe(9);
  });

  it("напоминание, а задачу уже закрыли — ничего не заводим", async () => {
    const gh = fakeGithub();
    const r = await trackAlertIssues(CFG, input({ fresh: [] }));
    expect(r).toEqual({ tracked: [], errors: [] });
    expect(gh.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("за сутки уже 3 автозапуска — задача с меткой alert-queued; старше суток не считаются", async () => {
    const gh = fakeGithub({
      issues: [
        alertIssue(1),
        alertIssue(2),
        alertIssue(3),
        alertIssue(4, { created_at: new Date(NOW - 25 * H).toISOString() }),
      ],
    });
    const r = await trackAlertIssues(CFG, input());
    expect(r.tracked[0]).toMatchObject({ action: "queued" });
    expect(gh.created()[0].labels).toEqual([{ name: "alert-queued" }]);
  });

  it("лимит считается и внутри прогона: вторая новая тревога сверх лимита — в очередь", async () => {
    const gh = fakeGithub({ issues: [alertIssue(1), alertIssue(2)] });
    const other: Issue = { ...issue, key: "errors:client", match: {} };
    const r = await trackAlertIssues(
      CFG,
      input({ notify: [issue, other], fresh: [issue.key, other.key] }),
    );
    expect(r.tracked.map((t) => t.action)).toEqual(["created", "queued"]);
    expect(gh.created().map((i) => i.labels[0].name)).toEqual([
      "alert",
      "alert-queued",
    ]);
  });

  it("сбой создания — ошибка по тревоге, без токена в тексте", async () => {
    fakeGithub({ fail: true });
    await expect(trackAlertIssues(CFG, input())).rejects.toThrow(
      /GitHub GET \/repos\/me\/alerts\/issues 500: Server Error/,
    );
  });
});

describe("runMonitor + задачи в GitHub", () => {
  const snapshot: MonitorSnapshot = {
    now: NOW,
    errorsByEvent: [],
    http5xxByPath: [{ path: "/api/x", window: 5 }],
    engine: null,
    cronFailures: [],
    earnLastAt: NOW,
  };

  function deps(patch: Partial<MonitorDeps> = {}) {
    let rows: AlertRow[] = [];
    const sent: string[] = [];
    const d: MonitorDeps = {
      collect: async (now) => ({ ...snapshot, now, earnLastAt: now }),
      samples: async () => [],
      loadAlerts: async () => rows,
      saveAlerts: async (r) => {
        rows = r;
      },
      analyze: async () => "Упал Binance.",
      notify: async (t) => {
        sent.push(t);
      },
      trackIssues: (i) => trackAlertIssues(CFG, i),
      prune: async () => 0,
      logsUrl: "https://example.test/logs",
      ...patch,
    };
    return { d, sent, rows: () => rows };
  }

  it("новая тревога — ссылка «Claude разбирает» в Telegram; напоминание через 2 ч — комментарий и ссылка", async () => {
    const gh = fakeGithub();
    const m = deps();
    const r = await runMonitor(m.d, NOW);
    expect(r.tracked).toHaveLength(1);
    expect(m.sent[0]).toContain(`🤖 Claude разбирает: ${REPO}/issues/1000`);

    await runMonitor(m.d, NOW + 2 * H);
    expect(gh.created()).toHaveLength(1);
    expect(gh.comments).toHaveLength(1);
    expect(m.sent[1]).toContain(`📎 Задача: ${REPO}/issues/1000`);
  });

  it("сверх лимита — в Telegram указано «лимит автозапусков на сутки»", async () => {
    fakeGithub();
    const m = deps({
      trackIssues: (i) => trackAlertIssues({ ...CFG, autofixPerDay: 0 }, i),
    });
    await runMonitor(m.d, NOW);
    expect(m.sent[0]).toContain(
      `📝 Задача: ${REPO}/issues/1000 (лимит автозапусков на сутки)`,
    );
  });

  it("GitHub упал — уведомление уходит без ссылки, состояние сохранено, ошибка в результате", async () => {
    fakeGithub({ fail: true });
    const m = deps();
    const r = await runMonitor(m.d, NOW);
    expect(r.sent).toBe(true);
    expect(r.githubErrors[0]).toContain("GitHub GET");
    expect(m.sent[0]).toContain("Ручка /api/x");
    expect(m.sent[0]).not.toContain("github.com");
    expect(m.rows()[0].lastSent).toBe(new Date(NOW).toISOString());
  });

  it("без токена (trackIssues не задан) — как раньше: без запросов к GitHub", async () => {
    const gh = fakeGithub();
    const m = deps({ trackIssues: undefined });
    const r = await runMonitor(m.d, NOW);
    expect(r).toMatchObject({ sent: true, tracked: [], githubErrors: [] });
    expect(gh.calls).toEqual([]);
    expect(m.sent[0]).not.toContain("Задача");
  });
});
