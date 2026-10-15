import type { Glossary } from "@/shared/lib";

/** Поиск по глоссарию: подстрока без учёта регистра в термине, сокращении, коде или описании. */
export function filterGlossary(glossary: Glossary, query: string): Glossary {
  const q = query.trim().toLocaleLowerCase("ru-RU");
  if (!q) return glossary;
  const hit = (s: string) => s.toLocaleLowerCase("ru-RU").includes(q);
  return {
    sections: glossary.sections
      .map((s) => ({
        title: s.title,
        terms: s.terms.filter(
          (t) =>
            hit(t.term) || hit(t.abbr) || hit(t.code) || hit(t.description),
        ),
      }))
      .filter((s) => s.terms.length > 0),
  };
}
