import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  decrypt,
  encrypt,
  parseMasterKey,
  readMasterKeyFile,
  type Sealed,
} from "./aesGcm.server";

const key = randomBytes(32);
const AAD = "binance-main";
const SECRET = JSON.stringify({ apiKey: "k".repeat(64), apiSecret: "s" });

/** Меняет один байт base64-поля. */
const flip = (b64: string) => {
  const buf = Buffer.from(b64, "base64");
  buf[0] ^= 0x01;
  return buf.toString("base64");
};

describe("encrypt / decrypt", () => {
  it("круг: расшифровка возвращает исходный текст; IV новый на каждую запись", () => {
    const a = encrypt(key, SECRET, AAD);
    const b = encrypt(key, SECRET, AAD);
    expect(decrypt(key, a, AAD)).toBe(SECRET);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
    expect(a.ciphertext).not.toContain("kkkk");
  });

  it("чужой мастер-ключ — ошибка", () => {
    const sealed = encrypt(key, SECRET, AAD);
    expect(() => decrypt(randomBytes(32), sealed, AAD)).toThrow(
      /не расшифровывается/,
    );
  });

  it.each<[string, (s: Sealed) => Sealed]>([
    ["шифротекст", (s) => ({ ...s, ciphertext: flip(s.ciphertext) })],
    ["тег", (s) => ({ ...s, tag: flip(s.tag) })],
    ["IV", (s) => ({ ...s, iv: flip(s.iv) })],
  ])("подмена: %s — ошибка", (_, tamper) => {
    const sealed = encrypt(key, SECRET, AAD);
    expect(() => decrypt(key, tamper(sealed), AAD)).toThrow();
  });

  it("другая AAD (имя записи) — ошибка: шифротекст нельзя переставить в другую запись", () => {
    const sealed = encrypt(key, SECRET, AAD);
    expect(() => decrypt(key, sealed, "other-record")).toThrow(
      /не расшифровывается/,
    );
  });

  it("усечённый тег — ошибка до расшифровки", () => {
    const sealed = encrypt(key, SECRET, AAD);
    expect(() =>
      decrypt(key, { ...sealed, tag: sealed.tag.slice(0, 8) }, AAD),
    ).toThrow(/неверная длина/);
  });

  it("мастер-ключ не 32 байта — ошибка", () => {
    expect(() => encrypt(randomBytes(16), SECRET, AAD)).toThrow(/32 байта/);
  });

  it("текст ошибки не содержит ни данных, ни ключа", () => {
    const sealed = encrypt(key, SECRET, AAD);
    try {
      decrypt(randomBytes(32), sealed, AAD);
    } catch (error) {
      const text = String(error);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(key.toString("base64"));
    }
  });
});

describe("parseMasterKey / readMasterKeyFile", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "master-key-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("base64 32 байт с переводом строки в конце — ключ", () => {
    expect(parseMasterKey(`${key.toString("base64")}\n`).equals(key)).toBe(
      true,
    );
  });

  it.each([
    ["пусто", ""],
    ["16 байт", randomBytes(16).toString("base64")],
    ["не base64", "это не ключ, а слова — их Buffer молча проглотил бы"],
  ])("%s — ошибка «повреждён»", (_, text) => {
    expect(() => parseMasterKey(text)).toThrow(/повреждён/);
  });

  it("файл читается; нет файла — ошибка с кодом, без содержимого", () => {
    const file = path.join(dir, "master.key");
    writeFileSync(file, key.toString("base64"));
    expect(readMasterKeyFile(file).equals(key)).toBe(true);
    expect(() => readMasterKeyFile(path.join(dir, "nope"))).toThrow(/ENOENT/);
  });
});
