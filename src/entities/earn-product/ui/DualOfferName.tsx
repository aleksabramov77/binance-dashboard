import { cn } from "@/shared/lib";
import type { DualOffer, DualSide } from "../model/schema";

export const DUAL_SIDE_LABELS: Record<DualSide, string> = {
  "buy-low": "Buy Low",
  "sell-high": "Sell High",
};

/** «BTC / USDT · Buy Low». */
export function DualOfferName({ offer }: { offer: DualOffer }) {
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      <span className="font-semibold">{offer.coin}</span>
      <span className="text-xs text-muted-foreground">/ {offer.stable}</span>
      <span
        className={cn(
          "text-xs font-medium",
          offer.side === "buy-low" ? "text-positive" : "text-orange-500",
        )}
      >
        {DUAL_SIDE_LABELS[offer.side]}
      </span>
    </span>
  );
}
