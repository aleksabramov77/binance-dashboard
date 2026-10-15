import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    undefined,
  );

const clientError = {
  source: "query",
  message: "Invalid option: expected one of spot|futures",
  url: "/signals",
};

describe("POST /api/logs — ошибки браузера", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_new");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("ошибку вкладки со старой сборкой пишет как warn client.stale с обеими версиями", async () => {
    const res = await post({ ...clientError, version: "dpl_old" });
    expect(res.status).toBe(200);
    expect(log.error).not.toHaveBeenCalledWith(
      "client",
      expect.anything(),
      expect.anything(),
    );
    expect(log.warn).toHaveBeenCalledWith(
      "client.stale",
      `${clientError.source}: ${clientError.message}`,
      expect.objectContaining({
        source: clientError.source,
        clientVersion: "dpl_old",
        serverVersion: "dpl_new",
        url: clientError.url,
      }),
    );
  });

  it("ошибку клиента текущей версии пишет как error client", async () => {
    await post({ ...clientError, version: "dpl_new" });
    expect(log.error).toHaveBeenCalledWith(
      "client",
      `${clientError.source}: ${clientError.message}`,
      expect.objectContaining({ source: clientError.source }),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("ошибку клиента без версии пишет как error client", async () => {
    await post(clientError);
    expect(log.error).toHaveBeenCalledWith(
      "client",
      `${clientError.source}: ${clientError.message}`,
      expect.objectContaining({ source: clientError.source }),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("без версии сервера (локально) ошибка с версией клиента — error client", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
    await post({ ...clientError, version: "dpl_old" });
    expect(log.error).toHaveBeenCalledWith(
      "client",
      expect.any(String),
      expect.any(Object),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});
