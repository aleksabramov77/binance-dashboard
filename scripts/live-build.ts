// `pnpm live:build` — воркер реального счёта одним файлом для VM (spec 0047): esbuild → dist/live-worker.mjs
// (ESM, Node 22, все зависимости внутри). На VM его запускает systemd как `node live-worker.mjs` без node_modules.
// Версия воркера (в пульсе и журнале) — версия пакета + короткий хэш коммита.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "esbuild";

const root = process.cwd();

/**
 * Пакеты, которых в бандле воркера быть не должно: React и TanStack (UI сущности тянется через её public API и
 * сейчас вырезается tree-shaking'ом — проверяем, а не надеемся), драйверы БД better-sqlite3 и postgres (воркер в БД не
 * ходит, только в API приложения).
 */
const FORBIDDEN_PACKAGES = [
  "react",
  "react-dom",
  "@tanstack/",
  "better-sqlite3",
  "postgres",
];

/** Имя пакета из пути модуля в node_modules (с учётом .pnpm и scope); null — не из node_modules. */
function packageOf(input: string): string | null {
  const parts = input.split("node_modules/");
  if (parts.length < 2) return null;
  const rest = parts[parts.length - 1].split("/");
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}
const outfile = path.join(root, "dist", "live-worker.mjs");

/**
 * Модули кода проекта (src/, packages/) — без побочных эффектов при импорте: public API слайсов (index.ts) отдаёт и
 * UI, и схемы, а воркеру нужны только схемы и серверные функции. С этой пометкой esbuild выбрасывает неиспользуемые
 * модули целиком (React-компоненты сущностей и с ними react), а не только их неиспользуемые экспорты. Код проекта
 * при импорте ничего не делает (журнал без файлов включает сам воркер вызовом disableLogFiles).
 */
const projectSideEffectFree: Plugin = {
  name: "project-side-effect-free",
  setup(b) {
    b.onResolve({ filter: /^(@\/|\.{1,2}\/)/ }, async (args) => {
      if (args.pluginData === "inner") return undefined;
      const resolved = await b.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: "inner",
      });
      if (resolved.errors.length) return { errors: resolved.errors };
      const own =
        !resolved.path.includes(`${path.sep}node_modules${path.sep}`) &&
        (resolved.path.startsWith(path.join(root, "src")) ||
          resolved.path.startsWith(path.join(root, "packages")));
      return own &&
        resolved.path !== path.join(root, "scripts", "live-worker.ts")
        ? { ...resolved, sideEffects: false }
        : resolved;
    });
  },
};

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
  const result = await build({
    entryPoints: [path.join(root, "scripts", "live-worker.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Пути @/* — из tsconfig.json; всё — внутрь файла. drizzle-orm попадает только описанием таблицы из public API
    // сущности (sqlite-core, без драйвера БД); запрещённые пакеты проверяются ниже по metafile.
    tsconfig: path.join(root, "tsconfig.json"),
    define: {
      "process.env.LIVE_WORKER_VERSION": JSON.stringify(workerVersion),
    },
    // CommonJS-зависимости внутри ESM-бандла зовут require — даём его из node:module.
    banner: {
      js: "import { createRequire as __liveCreateRequire } from 'node:module'; const require = __liveCreateRequire(import.meta.url);",
    },
    legalComments: "none",
    metafile: true,
    plugins: [projectSideEffectFree],
    logLevel: "warning",
  });
  const output = Object.values(result.metafile.outputs)[0];
  const bundled = new Set(
    Object.keys(output?.inputs ?? {}).flatMap((input) => {
      const pkg = packageOf(input);
      return pkg ? [pkg] : [];
    }),
  );
  const forbidden = [...bundled].filter((pkg) =>
    FORBIDDEN_PACKAGES.some((f) =>
      f.endsWith("/") ? pkg.startsWith(f) : pkg === f,
    ),
  );
  if (forbidden.length)
    throw new Error(
      `в бандл воркера попали запрещённые пакеты: ${forbidden.join(", ")} — воркеру нужны только zod и node:*`,
    );
  const kb = Math.round(statSync(outfile).size / 1024);
  console.log(
    `[live:build] ${path.relative(root, outfile)} (${kb} КБ), версия ${workerVersion}; пакеты: ${[...bundled].sort().join(", ")}`,
  );
}

main().catch((error) => {
  console.error(
    `[live:build] ✖ ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
