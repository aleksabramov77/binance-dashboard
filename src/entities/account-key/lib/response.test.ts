import { describe, expect, it } from "vitest";
import {
  AccountKeyError,
  isExpectedAccountKeyRejection,
  readAccountKeyResponse,
} from "./response";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe("readAccountKeyResponse", () => {
  it("отказ 422 — AccountKeyError с текстом, причинами и статусом", async () => {
    const error = await readAccountKeyResponse(
      json(422, { error: "Ключ не сохранён", reasons: ["вывод"] }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountKeyError);
    expect(error).toMatchObject({
      message: "Ключ не сохранён",
      status: 422,
      reasons: ["вывод"],
    });
  });

  it("тело не распознано — общий текст со статусом", async () => {
    await expect(
      readAccountKeyResponse(new Response("oops", { status: 500 })),
    ).rejects.toMatchObject({
      message: "Ключ аккаунта: ошибка 500",
      status: 500,
    });
  });
});

describe("isExpectedAccountKeyRejection", () => {
  it("4xx от /api/account-key — ожидаемый отказ (не error в журнал)", () => {
    for (const status of [400, 409, 415, 422])
      expect(
        isExpectedAccountKeyRejection(new AccountKeyError("x", status)),
      ).toBe(true);
  });

  it("5xx, сеть и прочие ошибки — сбой, пишется как раньше", () => {
    expect(isExpectedAccountKeyRejection(new AccountKeyError("x", 502))).toBe(
      false,
    );
    expect(isExpectedAccountKeyRejection(new AccountKeyError("x", 500))).toBe(
      false,
    );
    expect(
      isExpectedAccountKeyRejection(new TypeError("Failed to fetch")),
    ).toBe(false);
  });
});
