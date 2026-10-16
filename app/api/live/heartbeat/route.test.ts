import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveHeartbeat } from "@/entities/live-account";

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/shared/lib/logger.server", async (orig) => ({
  ...(await orig<typeof import("@/shared/lib/logger.server")>()),
  log,
  flushLogs: vi.fn(async () => {}),
}));
const ingest = vi.hoisted(() => vi.fn());
vi.mock("@/app/server/liveAccount", () => ({ ingestHeartbeat: ingest }));
const { POST } = await import("./route");

const pulse: LiveHeartbeat = {
  version: "test",
  handshake: false,
  sentAt: "2026-10-16T12:00:00.000Z",
  fixture: null,
  verdict: "ok",
  reasons: [],
  warnings: [],
  restrictions: { flags: null, checkedAt: null },
  uid: { status: "different", note: null },
  spot: null,
  usdm: null,
  balancesNote: null,
  error: null,
};

const post = (body: unknown, authorization?: string) =>
  POST(
    new Request("http://localhost/api/live/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    }),
    undefined,
  );

describe("POST /api/live/heartbeat", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LIVE_WORKER_SECRET", "s3cret");
    ingest.mockResolvedValue({ ok: true, verdict: "ok" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("без секрета и с неверным секретом — 401, пульс не принимается", async () => {
    expect((await post(pulse)).status).toBe(401);
    expect((await post(pulse, "Bearer nope")).status).toBe(401);
    expect((await post(pulse, "s3cret")).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("в production без LIVE_WORKER_SECRET — 503 (закрыто)", async () => {
    vi.stubEnv("LIVE_WORKER_SECRET", "");
    const res = await post(pulse, "Bearer s3cret");
    expect(res.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("верный секрет — пульс принят, ответ приложения", async () => {
    const res = await post(pulse, "Bearer s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, verdict: "ok" });
    expect(ingest).toHaveBeenCalledWith(pulse);
  });

  it("тело не по схеме — 400 с причиной", async () => {
    const { verdict: _, ...broken } = pulse;
    const res = await post(broken, "Bearer s3cret");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Пульс не распознан: verdict/);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("фикстура в production — 400", async () => {
    const res = await post({ ...pulse, fixture: "ok" }, "Bearer s3cret");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Фикстуры/);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("локально без секрета пульс и фикстура принимаются", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LIVE_WORKER_SECRET", "");
    expect((await post({ ...pulse, fixture: "ok" })).status).toBe(200);
  });

  it("площадка демо в production — 400: пульс с пометкой demo-venue и любой запрос с заголовком площадки демо", async () => {
    const res = await post(
      { ...pulse, fixture: "demo-venue" },
      "Bearer s3cret",
    );
    expect(res.status).toBe(400);
    const withHeader = await POST(
      new Request("http://localhost/api/live/heartbeat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer s3cret",
          "x-live-venue": "demo",
        },
        body: JSON.stringify(pulse),
      }),
      undefined,
    );
    expect(withHeader.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
});
