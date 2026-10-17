import { describe, expect, it } from "vitest";
import {
  dbPullConfig,
  parseDbPullArgs,
  remoteBackupCommand,
  remoteBackupFetchCommand,
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
      backup: null,
    });
    expect(parseDbPullArgs(["--out", "x.db"], "data/prod.db")).toEqual({
      ok: true,
      out: "x.db",
      backup: null,
    });
    expect(parseDbPullArgs(["--out=y.db"], "data/prod.db")).toEqual({
      ok: true,
      out: "y.db",
      backup: null,
    });
    expect(parseDbPullArgs(["--out"], "data/prod.db").ok).toBe(false);
    expect(parseDbPullArgs(["--prod"], "data/prod.db").ok).toBe(false);
  });
});

describe("ночные копии (spec 0062)", () => {
  it("--backup без даты — последняя копия в data/backup-latest.db", () => {
    expect(parseDbPullArgs(["--backup"], "data/prod.db")).toEqual({
      ok: true,
      out: "data/backup-latest.db",
      backup: "latest",
    });
  });
  it("--backup с датой — копия дня; --out главнее пути по умолчанию", () => {
    expect(parseDbPullArgs(["--backup", "2026-10-16"], "data/prod.db")).toEqual(
      {
        ok: true,
        out: "data/backup-2026-10-16.db",
        backup: "2026-10-16",
      },
    );
    expect(
      parseDbPullArgs(["--backup=2026-10-16", "--out", "z.db"], "data/prod.db"),
    ).toEqual({ ok: true, out: "z.db", backup: "2026-10-16" });
    expect(
      parseDbPullArgs(["--backup", "--out", "z.db"], "data/prod.db"),
    ).toEqual({ ok: true, out: "z.db", backup: "latest" });
  });
  it("--backup= с неверной датой — ошибка", () => {
    expect(parseDbPullArgs(["--backup=вчера"], "data/prod.db").ok).toBe(false);
  });
  it("команда на VM: копия дня или последняя, распаковка в stdout от пользователя сервиса", () => {
    const day = remoteBackupFetchCommand("2026-10-16");
    expect(day).toContain("f=/var/lib/binance/backups/app-2026-10-16.db.gz");
    expect(day).toContain('sudo -u binance gunzip -c "$f"');
    const latest = remoteBackupFetchCommand(null);
    expect(latest).toContain(
      "sudo -u binance find /var/lib/binance/backups -maxdepth 1 -name 'app-????-??-??.db.gz' | sort | tail -1",
    );
    expect(latest).toContain("exit 3");
    expect(() => remoteBackupFetchCommand("16.10.2026")).toThrow();
  });
});
