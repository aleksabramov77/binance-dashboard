// `pnpm glossary` — пересобрать src/pages/help/config/glossary.json из docs/ai/glossary.md.
// Источник истины — markdown (его читает AI); JSON коммитится и рендерится страницей /help.
// Тест src/pages/help/config/glossary.test.ts падает, если JSON отстал.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseGlossary } from "@/shared/lib/glossary";

const root = process.cwd();
const source = path.join(root, "docs/ai/glossary.md");
const target = path.join(root, "src/pages/help/config/glossary.json");

const glossary = parseGlossary(readFileSync(source, "utf8"));
const terms = glossary.sections.reduce((n, s) => n + s.terms.length, 0);
writeFileSync(target, `${JSON.stringify(glossary, null, 2)}\n`);
console.log(
  `[glossary] ${terms} терминов в ${glossary.sections.length} секциях → ${path.relative(root, target)}`,
);
