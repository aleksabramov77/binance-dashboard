import { describe, expect, it } from "vitest";
import type { AccountKeyStatus } from "@/entities/account-key";
import { accountKeyView } from "./view";

const base: AccountKeyStatus = {
  source: "db",
  stored: { hint: "AB12", savedAt: "2026-10-17T10:00:00.000Z", flags: null },
  decryptFailed: false,
  masterUnavailable: null,
  input: { available: true, reason: null },
  hosting: "cloud",
};

describe("accountKeyView", () => {
  it("ключ в базе работает — saved", () => {
    expect(accountKeyView(base)).toBe("saved");
  });

  it("ключа в базе нет — empty", () => {
    expect(accountKeyView({ ...base, source: "none", stored: null })).toBe(
      "empty",
    );
  });

  it("мастер-ключ не читается — master-unavailable, а не «введите заново»", () => {
    expect(
      accountKeyView({
        ...base,
        source: "none",
        masterUnavailable: "на сервере не задан мастер-ключ (SECRETS_KEY_FILE)",
        input: { available: false, reason: "на сервере не задан мастер-ключ" },
      }),
    ).toBe("master-unavailable");
  });

  it("мастер-ключ не подходит — decrypt-failed", () => {
    expect(
      accountKeyView({ ...base, source: "none", decryptFailed: true }),
    ).toBe("decrypt-failed");
  });
});
