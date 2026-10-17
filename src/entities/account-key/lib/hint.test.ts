import { describe, expect, it } from "vitest";
import { hintText, keyHint, scrubSecrets } from "./hint";

describe("keyHint / hintText", () => {
  it("последние 4 символа API Key → «…AB12»", () => {
    expect(hintText(keyHint(" abcdefghAB12 "))).toBe("…AB12");
  });
});

describe("scrubSecrets", () => {
  it("вычищает ключ и секрет из текста ошибки", () => {
    const key = "K".repeat(64);
    const secret = "S".repeat(64);
    expect(
      scrubSecrets(`ошибка ${key} и ${secret}, снова ${key}`, [key, secret]),
    ).toBe("ошибка *** и ***, снова ***");
  });

  it("короткие строки не заменяет", () => {
    expect(scrubSecrets("abc abc", ["abc"])).toBe("abc abc");
  });
});
