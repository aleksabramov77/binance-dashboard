import { describe, expect, it } from "vitest";
import {
  dbPullConfig,
  parseDbPullArgs,
  remoteBackupCommand,
  sshArgs,
} from "./dbPull";

describe("dbPullConfig", () => {
  it("без APPS_TOKYO_HOST — понятная ошибка", () => {
    const r = dbPullConfig({}, "/Users/me");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("APPS_TOKYO_HOST");
  });

  it("по умолчанию — пользователь claude и ключ lightsail_apps_tokyo; ~ раскрывается", () => {
    expect(
      dbPullConfig({ APPS_TOKYO_HOST: " vm.example " }, "/Users/me"),
    ).toEqual({
      ok: true,
      config: {
        host: "vm.example",
        user: "claude",
        keyFile: "/Users/me/.ssh/lightsail_apps_tokyo",
      },
    });
    expect(
      dbPullConfig(
        {
          APPS_TOKYO_HOST: "vm.example",
          APPS_TOKYO_SSH_USER: "aleksandr",
          APPS_TOKYO_SSH_KEY_FILE: "/keys/k",
        },
        "/Users/me",
      ),
    ).toEqual({
      ok: true,
      config: { host: "vm.example", user: "aleksandr", keyFile: "/keys/k" },
    });
  });
});

describe("remoteBackupCommand и sshArgs", () => {
  it("снимок — sqlite3 .backup от пользователя сервиса во временный файл, вывод в stdout, файл удаляется", () => {
    const cmd = remoteBackupCommand();
    expect(cmd).toContain(
      `sudo -u binance sqlite3 /var/lib/binance/app.db ".backup '$tmp'"`,
    );
    expect(cmd).toContain('sudo -u binance cat "$tmp"');
    expect(cmd).toContain("trap 'sudo -u binance rm -f \"$tmp\"' EXIT");
    expect(cmd.startsWith("set -e")).toBe(true);
  });

  it("ssh — только по ключу, без вопросов", () => {
    expect(
      sshArgs({ host: "vm.example", user: "claude", keyFile: "/k" }, "echo"),
    ).toEqual([
      "-i",
      "/k",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "claude@vm.example",
      "echo",
    ]);
  });
});

describe("parseDbPullArgs", () => {
  it("--out — путь снимка, по умолчанию data/prod.db", () => {
    expect(parseDbPullArgs([], "data/prod.db")).toEqual({
      ok: true,
      out: "data/prod.db",
    });
    expect(parseDbPullArgs(["--out", "x.db"], "data/prod.db")).toEqual({
      ok: true,
      out: "x.db",
    });
    expect(parseDbPullArgs(["--out=y.db"], "data/prod.db")).toEqual({
      ok: true,
      out: "y.db",
    });
    expect(parseDbPullArgs(["--out"], "data/prod.db").ok).toBe(false);
    expect(parseDbPullArgs(["--prod"], "data/prod.db").ok).toBe(false);
  });
});
