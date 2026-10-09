import { cn } from "@/shared/lib";
import type { Setup } from "../model/schema";

export function DirectionBadge({
  direction,
}: {
  direction: Setup["direction"];
}) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide",
        direction === "long"
          ? "bg-positive/15 text-positive"
          : "bg-destructive/15 text-destructive",
      )}
    >
      {direction === "long" ? "LONG" : "SHORT"}
    </span>
  );
}
