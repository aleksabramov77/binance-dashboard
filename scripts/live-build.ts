// `pnpm live:build` — воркер реального счёта одним файлом для VM (spec 0047): esbuild → dist/live-worker.mjs
// (ESM, Node 22, все зависимости внутри). На VM его запускает systemd как `node live-worker.mjs` без node_modules.
// Версия воркера (в пульсе и журнале) — версия пакета + короткий хэш коммита.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const outfile = path.join(root, "dist", "live-worker.mjs");

function gitShortSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "nogit";
  }
}

async function main() {
  const { version } = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { version: string };
  const workerVersion = `${version}+${gitShortSha()}`;
  await build({
    entryPoints: [path.join(root, "scripts", "live-worker.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Пути @/* — из tsconfig.json; всё, включая zod и drizzle-orm (описания таблиц), — внутрь файла.
    tsconfig: path.join(root, "tsconfig.json"),
    define: {
      "process.env.LIVE_WORKER_VERSION": JSON.stringify(workerVersion),
    },
    // CommonJS-зависимости внутри ESM-бандла зовут require — даём его из node:module.
    banner: {
      js: "import { createRequire as __liveCreateRequire } from 'node:module'; const require = __liveCreateRequire(import.meta.url);",
    },
    legalComments: "none",
    logLevel: "warning",
  });
  const kb = Math.round(statSync(outfile).size / 1024);
  console.log(
    `[live:build] ${path.relative(root, outfile)} (${kb} КБ), версия ${workerVersion}`,
  );
}

main().catch((error) => {
  console.error(
    `[live:build] ✖ ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
