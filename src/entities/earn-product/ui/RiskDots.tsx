import { cn } from "@/shared/lib";
import { RISK_LABELS, type RiskLevel } from "../config/kinds";

const COLORS: Record<RiskLevel, string> = {
  1: "bg-positive",
  2: "bg-positive",
  3: "bg-amber-500",
  4: "bg-orange-500",
  5: "bg-destructive",
};

/** Риск 1–5 точками: «●●○○○ низкий». */
export function RiskDots({
  level,
  withLabel = false,
}: {
  level: RiskLevel;
  withLabel?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`Риск ${level} из 5 — ${RISK_LABELS[level]}`}
    >
      <span className="inline-flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn(
              "size-2 rounded-full",
              i <= level ? COLORS[level] : "bg-muted",
            )}
          />
        ))}
      </span>
      <span
        className={cn(!withLabel && "sr-only", "text-xs text-muted-foreground")}
      >
        {withLabel ? RISK_LABELS[level] : `риск ${level} из 5`}
      </span>
    </span>
  );
}
