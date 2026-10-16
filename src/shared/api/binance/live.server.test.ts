import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  LIVE_DEMO_HOSTS,
  liveClient,
  liveSignedRequest,
  liveVenue,
} from "./live.server";
import { LiveRequestDeniedError } from "./liveAllowlist";

const client = liveClient({ live: { apiKey: "k", apiSecret: "s" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("liveSignedRequest", () => {
  it("запрос вне белого списка бросает ошибку до сети", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(() =>
      liveSignedRequest(
        client,
        { method: "POST", market: "spot", path: "/api/v3/order/test" },
        z.unknown(),
      ),
    ).toThrow(LiveRequestDeniedError);
    expect(() =>
      liveSignedRequest(
        client,
        {
          method: "POST",
          market: "spot",
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
      client,
      { method: "GET", market: "usdm", path: "/fapi/v3/account" },
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

  it("площадка Live: ордер из списка — через белый список на хост реального счёта", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const venue = liveVenue(client);
    expect(venue.kind).toBe("live");
    expect(venue.publicUrl).toEqual({
      spot: "https://api.binance.com",
      usdm: "https://fapi.binance.com",
    });
    await venue.signed("usdm", "POST", "/fapi/v1/order", z.unknown(), {
      symbol: "BTCUSDT",
    });
    expect(String((fetchSpy.mock.calls[0] as unknown as [string])[0])).toMatch(
      /^https:\/\/fapi\.binance\.com\/fapi\/v1\/order\?/,
    );
    // Вне списка (история ордеров, перевод) — отказ до сети.
    expect(() =>
      venue.signed("usdm", "GET", "/fapi/v1/allOrders", z.unknown()),
    ).toThrow(LiveRequestDeniedError);
    expect(() =>
      venue.signed("spot", "POST", "/sapi/v1/asset/transfer", z.unknown()),
    ).toThrow(/движение денег/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("площадка «демо» (локальная проверка) — те же правила, демо-хосты", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const venue = liveVenue(
      liveClient({ live: { apiKey: "d", apiSecret: "s" } }, LIVE_DEMO_HOSTS),
    );
    await venue.signed("spot", "GET", "/api/v3/openOrders", z.unknown());
    expect(String((fetchSpy.mock.calls[0] as unknown as [string])[0])).toMatch(
      /^https:\/\/demo-api\.binance\.com\/api\/v3\/openOrders\?/,
    );
    expect(() =>
      venue.signed("spot", "GET", "/api/v3/allOrders", z.unknown()),
    ).toThrow(LiveRequestDeniedError);
  });
});
