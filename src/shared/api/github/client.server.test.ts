import { afterEach, describe, expect, it, vi } from "vitest";
import { countIssuesCreatedSince, listOpenIssues } from "./client.server";

const CFG = { token: "secret-token", owner: "me", repo: "r" };
const raw = (n: number, createdAt: string, pr = false) => ({
  number: n,
  html_url: `https://github.com/me/r/issues/${n}`,
  title: `#${n}`,
  body: null,
  created_at: createdAt,
  labels: ["alert"],
  ...(pr ? { pull_request: { url: "x" } } : {}),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("github client", () => {
  it("список задач без pull request; токен — только в заголовке Authorization", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json([
        raw(1, "2026-10-16T10:00:00Z"),
        raw(2, "2026-10-16T10:00:00Z", true),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const list = await listOpenIssues(CFG);
    expect(list).toEqual([
      {
        number: 1,
        url: "https://github.com/me/r/issues/1",
        title: "#1",
        body: "",
        createdAt: "2026-10-16T10:00:00Z",
        labels: ["alert"],
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain("secret-token");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer secret-token",
    );
  });

  it("за сутки считает только созданные не раньше since (since GitHub — по изменению)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          raw(1, "2026-10-16T10:00:00Z"),
          raw(2, "2026-10-14T10:00:00Z"),
        ]),
      ),
    );
    expect(
      await countIssuesCreatedSince(
        CFG,
        "alert",
        new Date("2026-10-15T12:00:00Z"),
      ),
    ).toBe(1);
  });
});

describe("github client: страницы", () => {
  it("обходит страницы, пока страница полная; метка — в запросе", async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, k) =>
        raw(from + k, "2026-10-16T10:00:00Z"),
      );
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const p = Number(new URL(url).searchParams.get("page"));
      return Response.json(p === 1 ? page(1, 100) : page(101, 20));
    });
    vi.stubGlobal("fetch", fetchMock);
    const list = await listOpenIssues(CFG, { label: "alert" });
    expect(list).toHaveLength(120);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(fetchMock.mock.calls[0][0]);
    expect(first.searchParams.get("labels")).toBe("alert");
    expect(first.searchParams.get("per_page")).toBe("100");
  });

  it("не больше 10 страниц", async () => {
    const full = Array.from({ length: 100 }, (_, k) =>
      raw(k, "2026-10-16T10:00:00Z"),
    );
    const fetchMock = vi.fn(async () => Response.json(full));
    vi.stubGlobal("fetch", fetchMock);
    await listOpenIssues(CFG);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});
