/**
 * Включённые варианты эксперимента, если он — контрольный своей группы (spec 0050): по ним окно выключения показывает
 * предупреждение и галочку. У варианта и у эксперимента без группы — пусто.
 */
export function enabledFamilyVariants(
  id: string,
  family: {
    control: { id: string };
    variants: readonly { id: string; enabled: boolean }[];
  } | null,
): string[] {
  if (!family || family.control.id !== id) return [];
  return family.variants.filter((v) => v.enabled).map((v) => v.id);
}
