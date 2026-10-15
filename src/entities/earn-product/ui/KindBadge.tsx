import { Badge } from "@/shared/ui/badge";
import { EARN_KIND_INFO } from "../config/kinds";
import type { EarnKind } from "../model/schema";

/** Короткое имя вида продукта бейджем. */
export function KindBadge({ kind }: { kind: EarnKind }) {
  return <Badge variant="secondary">{EARN_KIND_INFO[kind].title}</Badge>;
}

/** «Защищён» / «не защищён» по виду; `withLabel` — с словом «капитал» (вне колонки «Капитал»). */
export function PrincipalBadge({
  kind,
  withLabel = false,
}: {
  kind: EarnKind;
  withLabel?: boolean;
}) {
  const prefix = withLabel ? "капитал " : "";
  return EARN_KIND_INFO[kind].principalProtected ? (
    <Badge variant="outline">{prefix}защищён</Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/50 text-destructive">
      {prefix}не защищён
    </Badge>
  );
}
