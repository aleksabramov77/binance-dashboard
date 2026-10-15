// Разбор глоссария из markdown (docs/ai/glossary.md): секции `##` и таблицы
// «Термин · Сокращение · Код · Описание». Чистая функция, без доменных знаний — её используют
// scripts/glossary.ts (генерация JSON для /help) и тест синхронизации.

export interface GlossaryTerm {
  term: string;
  abbr: string;
  code: string;
  description: string;
}

export interface GlossarySection {
  title: string;
  terms: GlossaryTerm[];
}

export interface Glossary {
  sections: GlossarySection[];
}

const HEADER = ["Термин", "Сокращение", "Код", "Описание"];

/** Ячейка таблицы: прочерк → "", обратные кавычки (код в markdown) снимаются — справка показывает простой текст. */
function cell(raw: string): string {
  const v = raw.trim();
  if (v === "—" || v === "-") return "";
  return v.replaceAll("`", "");
}

/** `| a | b |` → ["a", "b"]; null, если строка — не строка таблицы. */
function splitRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  return t.slice(1, t.endsWith("|") ? -1 : undefined).split("|");
}

export function parseGlossary(markdown: string): Glossary {
  const sections: GlossarySection[] = [];
  let current: GlossarySection | null = null;
  let headerSeen = false;
  const lines = markdown.split("\n");
  lines.forEach((line, i) => {
    const no = i + 1;
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = { title: h[1], terms: [] };
      sections.push(current);
      headerSeen = false;
      return;
    }
    const cells = splitRow(line);
    if (!cells || !current) return;
    if (/^\s*\|?\s*-{3,}/.test(line)) return; // разделитель шапки
    const values = cells.map((c) => c.trim());
    if (!headerSeen) {
      if (values.join("|") !== HEADER.join("|"))
        throw new Error(
          `Глоссарий, строка ${no}: шапка должна быть «${HEADER.join(" · ")}»`,
        );
      headerSeen = true;
      return;
    }
    if (cells.length !== HEADER.length)
      throw new Error(
        `Глоссарий, строка ${no}: ожидалось ${HEADER.length} колонки, получено ${cells.length}`,
      );
    current.terms.push({
      term: cell(cells[0]),
      abbr: cell(cells[1]),
      code: cell(cells[2]),
      description: cell(cells[3]),
    });
  });
  return { sections };
}
