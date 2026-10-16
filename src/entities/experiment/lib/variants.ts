// Варианты эксперимента (spec 0046): вариант проверяет одно изменение настроек рядом с работающим контрольным.
// Один уровень: у контрольного нет parentId. Буква варианта — по порядку id среди вариантов одного контрольного.

export interface VariantLink {
  id: string;
  parentId?: string | null;
}

/** 0 → A, 25 → Z, 26 → AA: буква варианта по номеру. */
export function variantLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Контрольный варианта или null: родитель должен быть в list и сам не быть вариантом (вариант варианта — вне
 * scope, такую связь не показываем).
 */
export function controlOf<T extends VariantLink>(
  e: VariantLink,
  byId: ReadonlyMap<string, T>,
): T | null {
  if (!e.parentId || e.parentId === e.id) return null;
  const parent = byId.get(e.parentId);
  return parent && !parent.parentId ? parent : null;
}

/** id контрольного → его варианты по порядку id. Варианты с неизвестным или «вложенным» родителем не попадают. */
export function variantsByControl<T extends VariantLink>(
  list: readonly T[],
): Map<string, T[]> {
  const byId = new Map(list.map((e) => [e.id, e]));
  const out = new Map<string, T[]>();
  for (const e of list) {
    const control = controlOf(e, byId);
    if (!control) continue;
    const group = out.get(control.id);
    if (group) group.push(e);
    else out.set(control.id, [e]);
  }
  for (const group of out.values())
    group.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** id варианта → буква (A, B, …) по порядку id среди вариантов его контрольного. */
export function variantLetters(
  list: readonly VariantLink[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const group of variantsByControl(list).values())
    group.forEach((e, i) => {
      out.set(e.id, variantLetter(i));
    });
  return out;
}

/** Включённые варианты контрольного: пока они идут, контрольный без явного согласия не выключается. */
export function enabledVariantsOf(
  list: readonly (VariantLink & { enabled: boolean })[],
  controlId: string,
): string[] {
  return (variantsByControl(list).get(controlId) ?? [])
    .filter((v) => v.enabled)
    .map((v) => v.id);
}
