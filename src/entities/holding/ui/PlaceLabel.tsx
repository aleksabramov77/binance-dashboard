import type { HoldingPlace } from "../model/schema";

export const PLACE_LABELS: Record<HoldingPlace, string> = {
  spot: "Spot",
  funding: "Funding",
  flexible: "Earn Flexible",
  locked: "Earn Locked",
};

export function PlaceLabel({ place }: { place: HoldingPlace }) {
  return (
    <span className="text-xs text-muted-foreground">{PLACE_LABELS[place]}</span>
  );
}
