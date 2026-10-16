import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { liveSignedRequest } from "./live.server";
import { LiveRequestDeniedError } from "./liveAllowlist";

const creds = { live: { apiKey: "k", apiSecret: "s" } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("liveSignedRequest", () => {
  it("запрос вне белого списка бросает ошибку до сети", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(() =>
      liveSignedRequest(
        creds,
        { method: "POST", host: "api.binance.com", path: "/api/v3/order" },
        z.unknown(),
      ),
    ).toThrow(LiveRequestDeniedError);
    expect(() =>
      liveSignedRequest(
        creds,
        {
          method: "POST",
          host: "api.binance.com",
          path: "/sapi/v1/capital/withdraw/apply",
        },
        z.unknown(),
      ),
    ).toThrow(/движение денег/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("разрешённый запрос уходит на свой хост с ключом в заголовке", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await liveSignedRequest(
      creds,
      { method: "GET", host: "fapi.binance.com", path: "/fapi/v3/account" },
      z.unknown(),
    );
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/^https:\/\/fapi\.binance\.com\/fapi\/v3\/account\?/);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ "X-MBX-APIKEY": "k" });
  });
});
