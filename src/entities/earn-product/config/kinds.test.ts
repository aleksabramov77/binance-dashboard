import { describe, expect, it } from "vitest";
import { EARN_KINDS } from "../model/schema";
import { EARN_KIND_INFO } from "./kinds";

describe("карточки видов Earn", () => {
  it("есть у каждого из 12 видов, тексты заполнены", () => {
    expect(EARN_KINDS).toHaveLength(12);
    for (const kind of EARN_KINDS) {
      const info = EARN_KIND_INFO[kind];
      for (const text of [
        info.title,
        info.tagline,
        info.howItWorks,
        info.whatYouCanLose,
        info.whoFor,
        info.liquidity,
      ])
        expect(text.length).toBeGreaterThan(0);
    }
  });

  it("уровни риска — стартовые константы spec 0019", () => {
    expect(
      Object.fromEntries(
        EARN_KINDS.map((k) => [k, EARN_KIND_INFO[k].riskLevel]),
      ),
    ).toEqual({
      "simple-flexible": 1,
      "simple-locked": 2,
      "soft-staking": 1,
      "eth-staking": 2,
      "sol-staking": 2,
      rwusd: 2,
      bfusd: 2,
      dual: 4,
      onchain: 5,
      "smart-arbitrage": 4,
      "auto-invest": 3,
      launchpool: 2,
    });
  });

  it("вкладка есть только у видов с данными; Dual и DeFi — капитал не защищён", () => {
    for (const kind of EARN_KINDS) {
      const info = EARN_KIND_INFO[kind];
      expect(info.tab !== null).toBe(
        info.hasData === "simple" || info.hasData === "catalog",
      );
    }
    expect(EARN_KIND_INFO.dual.principalProtected).toBe(false);
    expect(EARN_KIND_INFO.onchain.principalProtected).toBe(false);
  });
});
