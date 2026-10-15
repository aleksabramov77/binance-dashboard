import { Badge } from "@/shared/ui/badge";
import { EARN_KIND_INFO } from "../config/kinds";
import type { EarnKind } from "../model/schema";

/** Короткое имя вида продукта бейджем. */
export function KindBadge({ kind }: { kind: EarnKind }) {
  return <Badge variant="secondary">{EARN_KIND_INFO[kind].title}</Badge>;
}

/** «Капитал защищён» / «не защищён» по виду. */
export function PrincipalBadge({ kind }: { kind: EarnKind }) {
  return EARN_KIND_INFO[kind].principalProtected ? (
    <Badge variant="outline">защищён</Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/50 text-destructive">
      не защищён
    </Badge>
  );
}
