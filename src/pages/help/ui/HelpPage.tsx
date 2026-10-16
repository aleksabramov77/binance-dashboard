"use client";

import { useMemo, useState } from "react";
import { docUrl } from "@/shared/config";
import type { Glossary } from "@/shared/lib";
import { Input } from "@/shared/ui/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableFrame,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/Table";
import glossaryJson from "../config/glossary.json";
import { filterGlossary } from "../lib/filterGlossary";

const GLOSSARY = glossaryJson as Glossary;

const DOCS = [
  {
    path: "docs/ai/glossary.md",
    title: "Глоссарий",
    note: "источник истины этой страницы",
  },
  {
    path: "docs/ai/README.md",
    title: "Документация для AI",
    note: "архитектура, соглашения, процессы",
  },
  {
    path: "docs/PRD.md",
    title: "PRD",
    note: "требования, решения, журнал этапов",
  },
  { path: "docs/specs/", title: "ТЗ задач", note: "spec каждой фичи и бага" },
];

function Section({ title, terms }: Glossary["sections"][number]) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Термин</TableHead>
              <TableHead className="w-28">Сокращение</TableHead>
              <TableHead className="w-40">Код</TableHead>
              <TableHead>Описание</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {terms.map((t) => (
              <TableRow key={`${title}-${t.term}`}>
                <TableCell className="font-medium whitespace-normal">
                  {t.term}
                </TableCell>
                <TableCell>
                  {t.abbr || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-normal">
                  {t.code || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {/* Ширина описания ограничена: таблица по содержимому (spec 0022), а абзац в одну строку
                      растянул бы её на тысячи пикселей. На узком окне колонка сужается до 16rem. */}
                  <div className="max-w-[clamp(16rem,40vw,40rem)]">
                    {t.description}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
    </section>
  );
}

export function HelpPage() {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterGlossary(GLOSSARY, query), [query]);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Справка</h1>
          <p className="text-sm text-muted-foreground">
            Термины и сокращения дашборда. Источник —{" "}
            <code>docs/ai/glossary.md</code> в репозитории.
          </p>
        </div>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск: термин, сокращение, код…"
          className="w-72"
          aria-label="Поиск по глоссарию"
        />
      </header>
      {shown.sections.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Ничего не найдено по «{query}».
        </p>
      )}
      {shown.sections.map((s) => (
        <Section key={s.title} {...s} />
      ))}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Документация</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {DOCS.map((d) => (
            <li key={d.path}>
              <a
                href={docUrl(d.path)}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                {d.title}
              </a>{" "}
              <span className="text-muted-foreground">— {d.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
